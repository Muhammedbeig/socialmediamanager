/** An error whose message is written for the Member and safe to show on screen. */
export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserError";
  }
}
