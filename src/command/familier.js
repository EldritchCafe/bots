const { Masto } = require('masto')
const humanizeDuration = require('humanize-duration')
const parseIsoDuration = require('parse-iso-duration')
const chunkText = require('chunk-text')

const {
	asyncConsume,
	asyncFilter,
	asyncFlatMap,
	asyncSlice,
	asyncTakeWhile,
	asyncTap,
	pipe,
} = require('iter-tools/es2018')

exports.command = 'familier <domain> <token> <message>'

exports.describe = 'Welcome new users';

exports.builder = yargs => {
	yargs.positional('domain', { type: 'string' })
	yargs.positional('token', { type: 'string' })
	yargs.positional('message', { type: 'string' })

	yargs.option('max-chars', {
		type: 'number',
		default: 500
	})

	yargs.option('ignore-after', {
		type: 'string',
		default: 'PT1H',
		coerce: parseIsoDuration
	})

	yargs.option('fetch-requests', {
		describe: 'fetch requests (40 notifications are fetched per request)',
		type: 'number',
		default: 30
	})

	return yargs
}

exports.handler = async (argv) => {
	const start = Date.now()

	const ignoreAfter = start - argv.ignoreAfter

	const client = await Masto.login({
		uri: `https://${argv.domain}`,
		accessToken: argv.token
	})

	await pipe(
		client.fetchNotifications({
			limit: 40,
			exclude_types: [
				'favourite',
				'mention',
				'poll',
				'reblog'
			]
		}),
		asyncSlice(argv.fetchRequest),
		asyncFlatMap(x => x),
		asyncTakeWhile(notification => new Date(notification.created_at).getTime() >= ignoreAfter),
		asyncFilter(notification => notification.type === 'follow'),
		asyncTap(welcome),
		asyncTap(dissmiss),
		asyncConsume(() => {})
	)

	const end = Date.now()

	console.log(`Done in ${humanizeDuration(end - start)}`)



	async function welcome(follow) {
		if (!follow.account.acct.includes('@')) {
			const prefix = `@${follow.account.acct}\n\n`

			const messages = chunkText(argv.message, argv.maxChars - prefix.length)
				.map(message => prefix + message)

			await messages.reduce(async (acc, message) => {
				const previous = await acc

				return client.createStatus(Object.assign(
					{
						status: message,
						visibility: 'direct'
					},
					previous === null ? {} : { in_reply_to_id: previous.id }
				))
			}, Promise.resolve(null))

			console.log(`Welcome message sent to ${follow.account.acct} in ${messages.length} status(es)`)
		}
	}

	async function dissmiss(follow) {
		await client.dismissNotification(follow.id)
		console.log(`Dissmissed follow notification from ${follow.account.acct}`)
	}
}