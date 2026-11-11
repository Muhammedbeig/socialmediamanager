# Social Publisher

An internal marketing tool that takes content composed once and publishes it to many social media profiles at the same time.

## Language

### People and structure

**Member**:
A person who logs in to the app. Today there is one Member; the model allows more.
_Avoid_: User account, account, login

**Brand**:
A company or product being promoted, which groups the Channels that speak for it.
_Avoid_: Workspace, client, organization, account

**Channel**:
One connected social profile or Page on one network, such as "Acme on Instagram". A Brand can have several Channels on the same network.
_Avoid_: Account, social account, profile, connection

**Connector**:
The way a Channel's network is reached: through the network's official API, or through the visible browser.
_Avoid_: Integration, adapter, driver

### Publishing

**Post**:
The content composed once (media, caption, schedule) and sent to one or more Channels.
_Avoid_: Content, campaign, update, tweet

**Delivery**:
One Post going to one Channel, with its own status. A Post sent to six Channels has six Deliveries.
_Avoid_: Job, publication, share

**Post status**:
The state of a Post, derived from its Deliveries: Scheduled, Publishing, Published, Partly published, Failed or Removed.
_Avoid_: Overall status

**Needs attention**:
A Delivery paused until the Member acts in the visible browser, such as solving a CAPTCHA or a login check.
_Avoid_: Blocked, stuck, pending

**Edit**:
A change to the text of a live Delivery (caption, title, link) made in place on the network.
_Avoid_: Update, modify

**Replace**:
Removing a live Delivery and publishing a new one in its place, used when the media changes or the network cannot Edit. Likes and comments are lost.
_Avoid_: Repost, re-upload, edit media

**Removal**:
Taking a live Delivery down from its network. Each Delivery records its own removal result.
_Avoid_: Delete, unpublish
