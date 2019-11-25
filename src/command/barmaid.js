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

	yargs.option('user', {
		type: 'string',
		demandOption: true,
		coerce: (x) => Array.isArray(x) ? x : [x]
	})

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

	const accts = argv.user

	const ignoreAfter = start - argv.ignoreAfter

	const client = await Masto.login({
		uri: `https://${argv.domain}`,
		accessToken: argv.token
	})

	const botAccount = await client.verifyCredentials()

	await pipe(
		client.fetchNotifications({
			limit: 40,
			exclude_types: [
				'favourite',
				'follow',
				'poll',
				'reblog'
			]
		}),
		asyncSlice({ start: 0, step: 1, end: argv.fetchRequest}),
		asyncFlatMap(x => x),
		asyncTakeWhile(notification => new Date(notification.created_at).getTime() >= ignoreAfter),
		asyncFilter(notification => notification.type === 'mention'),
		asyncTap(handle),
		// asyncTap(dissmiss),
		asyncConsume(() => {})
	)

	const end = Date.now()

	console.log(`Done in ${humanizeDuration(end - start)}`)



	async function handle(mention) {
		const status = mention.status

		if (accts.some(acct => status.account.acct === acct)) {
			console.log('Status is from an admin')
			return
		}

		const context = await client.fetchStatusContext(status.id)

		if (context.ancestors.some(status => status.account.id === botAccount.id)) {
			console.log('Bot already participed in conversation')
			return
		}





		const forwardFullMessage = argv.forwardMessage
		const forwardUserMention = `@${mention.account.acct}\n\n`
		const forwardAdminsMention = `\n\ncc ${accts.map(x => '@' + x).join(' ')}`

		const forwardMessages = chunkText(forwardFullMessage, argv.maxChars - forwardUserMention.length - forwardAdminsMention.length)
			.map(message => forwardUserMention + message + forwardAdminsMention)


		const lastForwardStatus = await forwardMessages.reduce(async (acc, message) => {
			const previous = await acc

			const params = {
				status: message,
				visibility: status.visibility
			}

			if (previous !== null) {
				params.in_reply_to_id = previous.id
			}

			return client.createStatus(params)
		}, Promise.resolve(status))




		if (status.visibility === 'direct') {
			const copyFullMessage = argv.copyMessage + stripHtml(status.content)
			const copyAdminsMention = `${accts.map(x => '@' + x).join(' ')}\n\n`

			const copyMessages = chunkText(copyFullMessage, argv.maxChars - copyAdminsMention.length)
				.map(message =>  copyAdminsMention + message)

			await copyMessages.reduce(async (acc, message) => {
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
			}, Promise.resolve(lastForwardStatus))
		}
	}

	async function dissmiss(mention) {
		await client.dismissNotification(mention.id)
		console.log(`Dissmissed follow notification from ${mention.account.acct}`)
	}
}