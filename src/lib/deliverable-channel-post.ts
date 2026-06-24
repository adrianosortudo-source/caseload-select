import 'server-only';

/**
 * Fan deliverable review activity into the CaseLoad Connect channel.
 *
 * Every comment / note becomes a channel message attributed to its author,
 * carrying a typed context that the channel renders as a deep-link back to the
 * exact comment. Lifecycle events (approved / changes requested / new version)
 * post a short system-style line.
 *
 * These auto-posts set suppressNotification: the source deliverable event
 * already notifies (deliverable_comment_added / _approved / _changes_requested
 * / _review_requested), so the channel shows the activity without a second
 * digest entry. Called from the deliverable ROUTES (comments / approve /
 * versions) after the underlying mutation succeeds, never from the deliverables
 * data layer (kept decoupled). Best-effort: a post failure never blocks the
 * deliverable action.
 */

import {
  sendFirmMessage,
  findChannelMessageIdByCommentId,
  type MessageContext,
  type MessagingActor,
} from './operator-firm-messaging';
import type { DeliverableActor } from './deliverables';
import type { DeliverableAnnotation, DeliverableComment } from './types';

function toMessagingActor(actor: DeliverableActor): MessagingActor {
  if (actor.role === 'operator') return { role: 'operator', id: 'operator', name: 'CaseLoad' };
  return { role: 'lawyer', id: actor.id ?? 'lawyer', name: actor.name ?? 'The firm' };
}

function describeAnnotation(ann: DeliverableAnnotation | null): { label: string; prefix: string } {
  if (!ann) return { label: 'note', prefix: 'Note' };
  switch (ann.type) {
    case 'text': {
      const q = (ann.quote ?? '').trim().slice(0, 80);
      return { label: 'passage', prefix: q ? `On "${q}"` : 'On a passage' };
    }
    case 'pin':
    case 'region':
      return { label: 'image', prefix: 'On the image' };
    case 'page':
      return { label: `page ${ann.page}`, prefix: `On page ${ann.page}` };
    default:
      return { label: 'note', prefix: 'Note' };
  }
}

export async function postDeliverableCommentToChannel(input: {
  firmId: string;
  deliverableId: string;
  deliverableTitle: string;
  comment: DeliverableComment;
  actor: DeliverableActor;
}): Promise<void> {
  const { label, prefix } = describeAnnotation(input.comment.annotation ?? null);
  const body = `${prefix}: ${input.comment.body}`;

  // Thread a reply-comment under the channel message of its parent comment.
  let parent: string | null = null;
  if (input.comment.parent_comment_id) {
    parent = await findChannelMessageIdByCommentId(input.firmId, input.comment.parent_comment_id);
  }

  const context: MessageContext = {
    kind: 'deliverable_comment',
    deliverable_id: input.deliverableId,
    deliverable_title: input.deliverableTitle,
    comment_id: input.comment.id,
    version_id: input.comment.version_id,
    annotation_label: label,
  };

  await sendFirmMessage({
    firmId: input.firmId,
    actor: toMessagingActor(input.actor),
    body,
    parent_message_id: parent,
    context,
    suppressNotification: true,
  });
}

export async function postDeliverableLifecycleToChannel(input: {
  firmId: string;
  deliverableId: string;
  deliverableTitle: string;
  event: 'approved' | 'changes_requested' | 'new_version';
  actor: DeliverableActor;
}): Promise<void> {
  const verb =
    input.event === 'approved'
      ? 'Approved'
      : input.event === 'changes_requested'
      ? 'Requested changes on'
      : 'Posted a new version of';
  const body = `${verb} "${input.deliverableTitle}"`;

  const context: MessageContext = {
    kind: 'deliverable_lifecycle',
    deliverable_id: input.deliverableId,
    deliverable_title: input.deliverableTitle,
    event: input.event,
  };

  await sendFirmMessage({
    firmId: input.firmId,
    actor: toMessagingActor(input.actor),
    body,
    context,
    suppressNotification: true,
  });
}
