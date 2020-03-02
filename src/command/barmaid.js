const { Masto } = require('masto')
const humanizeDuration = require('humanize-duration')
const parseIsoDuration = require('parse-iso-duration')
const chunkText = require('chunk-text')
const stripHtml = require('string-strip-html')

const {
	asyncConsume,
	asyncFilter,
	asyncFlatMap,
	asyncSlice,
	asyncTakeWhile,
	asyncTap,
	pipe,
} = require('iter-tools/es2018')

exports.command = 'barmaid <domain> <token> <forward-message> <copy-message>'

exports.describe = 'Forwards mentions to other users';

exports.builder = yargs => {
	yargs.positional('domain', { type: 'string' })
	yargs.positional('token', { type: 'string' })
	yargs.positional('forward-message', { type: 'string' })
	yargs.positional('copy-message', { type: 'string' })

	yargs.option('forward-to', {
		describe: 'Users to mention. They are also ignored.',
		type: 'string',
		demandOption: true,
		coerce: (x) => Array.isArray(x) ? x : [x]
	})

	yargs.option('ignore-from', {
		describe: 'Users to ignore.',
		type: 'string',
		coerce: (x) => Array.isArray(x) ? x : [x]
	})

	yargs.option('characters-per-status', {
		describe: 'Limit characters per status. Defaults to 500 like Mastodon API.',
		type: 'number',
		default: 500
	})

	yargs.option('forward-until-duration', {
		type: 'string',
		default: 'PT5M',
		coerce: parseIsoDuration
	})

	yargs.option('fetch-until-count', {
		describe: 'Maximum allowed requests when retrieving notifications (40 notifications are fetched per request).',
		type: 'number',
		default: 30
	})

	yargs.option('fetch-until-duration', {
		describe: 'Maximum allowed duration difference when retrieving notifications (Mastodon API doesn\'t ensures chronological order).',
		type: 'string',
		default: 'PT6H',
		coerce: parseIsoDuration
	})

	return yargs
}

exports.handler = async (argv) => {
	const start = Date.now()

	const {
		domain,
		token,
		forwardMessage,
		copyMessage,
		forwardTo,
		ignoreFrom,
		charactersPerStatus,
		forwardUntilDuration,
		fetchUntilCount,
		fetchUntilDuration
	} = argv

	const client = await Masto.login({
		uri: `https://${domain}`,
		accessToken: token
	})

	const ignores = ignoreFrom.concat(forwardTo)

	const botAccount = await client.verifyCredentials()

	await pipe(
		// Fetch notifications, by 40 (maximum allowed by Mastodon) and excluding everything minus mentions
		// This way we can reduce requests
		client.fetchNotifications({
			limit: 40,
			exclude_types: [
				'favourite',
				'follow',
				'poll',
				'reblog'
			]
		}),
		// Limit fetch requests made to the API
		asyncSlice({ start: 0, step: 1, end: fetchUntilCount}),
		// Flatten
		asyncFlatMap(x => x),
		// Limit requests with stale notifications
		asyncTakeWhile(notification => new Date(notification.created_at).getTime() >= (start - fetchUntilDuration)),
		// Ensure with only deal with mentions, excluding might not be enough
		asyncFilter(notification => notification.type === 'mention'),
		// asyncFilter(mention => new Date(mention.created_at).getTime() >= (start - forwardUntilDuration)),
		asyncFilter(mention => !ignores.some(acct => mention.status.account.acct === acct)),

		asyncFilter(async mention => {
			const context = await client.fetchStatusContext(status.id)
			return !context.ancestors.some(status => status.account.id === botAccount.id)
		}),

		asyncTap(async mention => {
			const lastForwardStatus = forwardMention(client, forwardTo, forwardMessage, charactersPerStatus, mention);

			if (status.visibility === 'direct') {
				await copyMention(client, forwardTo, copyMessage, charactersPerStatus, mention, lastForwardStatus)
			}

			// await client.dismissNotification(mention.id)
			// console.log(`Dissmissed follow notification from ${mention.account.acct}`)
		}),
		asyncConsume(() => {})
	)

	const end = Date.now()

	console.log(`Done in ${humanizeDuration(end - start)}`)
}

async function forwardMention(client, forwardTo, message, charactersPerStatus, mention) {
	const prefix = `@${mention.account.acct}\n\n`
	const suffix = `\n\ncc ${forwardTo.map(x => '@' + x).join(' ')}`

	const chunkedMessages = chunkText(message, charactersPerStatus - prefix.length - suffix.length)
		.map(message => prefix + message + suffix)

	const chainedSend = async (acc, message) => {
		const previous = await acc

		const params = {
			status: message,
			visibility: status.visibility
		}

		if (previous !== null) {
			params.in_reply_to_id = previous.id
		}

		return client.createStatus(params)
	}

	return await chunkedMessages.reduce(chainedSend, Promise.resolve(status))
}

async function copyMention(client, forwardTo, message, charactersPerStatus, mention, statusToRespond) {
	const sanitizedMentionMessage = stripHtml(mention.status.content)
		.replace(/(^|\s+)@\s([\w\d\.]+)/i, '$1@\u{200b}$2')

	const prefix = `${forwardTo.map(x => '@' + x).join(' ')}\n\n`

	const chunkedMessages = chunkText(message + sanitizedMentionMessage, charactersPerStatus - prefix.length)
		.map(message =>  prefix + message)

	const chainedSend = async (acc, message) => {
		const previous = await acc

		const params = {
			status: message,
			visibility: status.visibility
		}

		if (previous !== null) {
			params.in_reply_to_id = previous.id
		}

		if (status.spoiler_text !== null) {
			params.spoiler_text = status.spoiler_text
		}

		return client.createStatus(params)
	}

	return await chunkedMessages.reduce(chainedSend, Promise.resolve(statusToRespond))
}