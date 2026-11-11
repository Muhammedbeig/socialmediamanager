import { type ContainerStatus, type Sleep, metaRequest, waitForContainer } from "./http";
import { type ChannelAccess, ConnectorError, type PublishInput, type PublishResult } from "../types";

// Instagram and Threads publish in two steps: create a "container" from media on a public URL,
// wait until the network has processed it, then publish the container.
// The container ID is saved before publishing, so a retry reuses it instead of posting twice.

export type ContainerApi = {
  network: string;
  graph: string;
  /** The endpoint that creates containers, under /{user-id}/. */
  createPath: string;
  /** The endpoint that publishes a container, under /{user-id}/. */
  publishPath: string;
  /** Fields for a single-media or text container. */
  single(input: PublishInput): Record<string, string>;
  /** Fields for one carousel item. */
  carouselItem(media: PublishInput["media"][number]): Record<string, string>;
  /** Fields for the carousel container itself. */
  carousel(input: PublishInput, children: string[]): Record<string, string>;
  /** Reads a container's status. */
  readStatus(containerId: string, accessToken: string): Promise<{ status: ContainerStatus; message?: string }>;
  intervalMs: number;
  maxWaitMs: number;
  sleep: Sleep;
};

export async function publishThroughContainer(
  api: ContainerApi,
  access: ChannelAccess,
  input: PublishInput,
): Promise<PublishResult> {
  const user = access.externalId;
  const token = access.accessToken;
  const wait = (containerId: string) =>
    waitForContainer(() => api.readStatus(containerId, token), {
      sleep: api.sleep,
      intervalMs: api.intervalMs,
      maxMs: api.maxWaitMs,
      network: api.network,
    });

  let containerId = typeof input.state.containerId === "string" ? input.state.containerId : null;
  if (containerId) {
    const { status } = await api.readStatus(containerId, token);
    if (status === "PUBLISHED") {
      throw new ConnectorError("outcome_unknown", `${api.network} says an earlier attempt already published this.`);
    }
    // An expired or broken container from an earlier attempt is replaced with a new one.
    if (status === "EXPIRED" || status === "ERROR") containerId = null;
  }

  if (!containerId) {
    const create = (fields: Record<string, string>) =>
      metaRequest<{ id: string }>(`${api.graph}/${user}/${api.createPath}`, {
        method: "POST",
        form: fields,
        accessToken: token,
      });
    if (input.format === "carousel") {
      const children: string[] = [];
      for (const media of input.media) children.push((await create(api.carouselItem(media))).id);
      for (const child of children) await wait(child);
      containerId = (await create(api.carousel(input, children))).id;
    } else {
      containerId = (await create(api.single(input))).id;
    }
    await input.saveState({ ...input.state, containerId });
  }

  await wait(containerId);

  const { id } = await metaRequest<{ id: string }>(`${api.graph}/${user}/${api.publishPath}`, {
    method: "POST",
    form: { creation_id: containerId },
    accessToken: token,
    onNoAnswer: "outcome_unknown",
  });

  let liveUrl: string | null = null;
  try {
    liveUrl = (await metaRequest<{ permalink?: string }>(`${api.graph}/${id}?fields=permalink`, { accessToken: token }))
      .permalink ?? null;
  } catch {
    // The post is live even if its link cannot be read.
  }
  return { externalPostId: id, liveUrl };
}

export function publicUrl(media: PublishInput["media"][number], network: string): string {
  if (!media.publicUrl) throw new ConnectorError("rejected", `${network} needs the media on a public URL.`);
  return media.publicUrl;
}
