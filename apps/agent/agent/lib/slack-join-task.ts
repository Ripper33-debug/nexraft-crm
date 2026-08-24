import type { Prisma } from "@crm/db";
import { parse, schemas } from "@crm/validation";
import { joinSlackChannel } from "./slack-membership";

export async function runSlackChannelJoin(
	value: Prisma.JsonValue,
): Promise<string> {
	const { channelId, channelName } = parse(
		schemas.slack.joinPayload,
		value,
		"A slack-channel-join task carries an unreadable payload",
	);
	const outcome = await joinSlackChannel(channelId);

	if (outcome.joined) {
		return outcome.already
			? `Nexraft was already in #${channelName}.`
			: `Nexraft joined #${channelName}.`;
	}

	return `Nexraft could not join #${channelName}. ${outcome.reason}`;
}
