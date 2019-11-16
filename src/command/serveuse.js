const { Masto } = require('masto')
const humanizeDuration = require('humanize-duration')
const parseIsoDuration = require('parse-iso-duration');

const {
	asyncFlatMap,
	asyncSlice,
	asyncToArray,
	pipe,
	filter,
	reduce,
	slice,
	toArray
} = require('iter-tools/es2018')

exports.command = 'serveuse <domain> <token>';

exports.describe = 'Rebblog appreciated status from users';

exports.builder = yargs => {
	yargs.positional('domain', {
		type: 'string'
	})

	yargs.positional('token', {
		type: 'string'
	})

	yargs.option('favorited-duration', {
		describe: 'only local statuses',
		type: 'string',
		default: 'P56D'
	})

	yargs.option('reblogged-duration', {
		describe: 'only local statuses',
		type: 'string',
		default: 'P1D'
	})

	yargs.option('dry-run', {
		describe: 'don\'t reblog',
		type: 'boolean',
		default: false
	})

	yargs.option('fetch-requests', {
		describe: 'fetch requests (40 statuses are fetched per request)',
		type: 'number',
		default: 250
	})

	yargs.option('reblog-requests', {
		describe: 'maximum reblog requests',
		type: 'number',
		default: 3
	})

	yargs.coerce(['favorited-duration', 'reblogged-duration'], parseIsoDuration)

	return yargs
}

exports.handler = async (argv) => {
	const start = Date.now()

	const favoritedDurationThreshold = start - argv.favoritedDuration
	const rebloggableDurationThreshold = start - argv.rebloggedDuration

	const client = await Masto.login({
		uri: `https://${argv.domain}`,
		accessToken: argv.token
	})

	console.log(`Fetching statuses, may take a while.`)

	const statuses = await pipe(
		client.fetchPublicTimeline({ limit: 40 }),
		asyncSlice(argv.fetchRequests),
		asyncFlatMap(x => x),
		asyncToArray
	)

	console.log(`Fetched ${statuses.length} statuses.`)

	const favoritedStatuses = statuses
		.filter(status => status.favourites_count > 0)
		.filter(status => new Date(status.created_at).getTime() >= favoritedDurationThreshold)

	console.log(`Found ${favoritedStatuses.length} favorited statuses.`)

	const favoritesTotal = favoritedStatuses
		.map(status => status.favourites_count)
		.reduce((a, x) => a + x, 0)

	const favoritesAverage = favoritesTotal / favoritedStatuses.length

	console.log(`Favorites average is ${favoritesAverage}.`)

	const rebloggableStatuses = pipe(
		favoritedStatuses,
		filter(status => !status.reblogged),
		filter(status => status.favourites_count >= favoritesAverage),
		filter(status => new Date(status.created_at).getTime() >= rebloggableDurationThreshold),
		reverse,
		uniqueByAccount,
		toArray
	)

	console.log(`Found ${rebloggableStatuses.length} rebloggables statuses.`)

	if (!argv.dryRun) {
		await pipe(
			rebloggableStatuses,
			slice(argv.reblogRequests),
			reduce(Promise.resolve(), async (acc, status) => {
				await acc
				await client.reblogStatus(status.id)

				console.log(`Reblogged status ${status.id} by ${status.account.acct}`)
			})
		)
	}

	const end = Date.now()

	console.log(`Done in ${humanizeDuration(end - start)}`)
}

function* reverse(source) {
	let array = source;

	if (false || !Array.isArray(array)) {
		array = toArray(array);
	}

	for (let i = array.length - 1; i >= 0; i--) {
		yield array[i];
	}
}

function uniqueByAccount(statuses) {
	const accountSet = new Set()

	return filter((status) => {
		const seen = accountSet.has(status.account.id)
		accountSet.add(status.account.id)
		return !seen
	}, statuses)
}