const yargs = require('yargs')

yargs
	.strict()
	.command(require('./command/barmaid'))
	.command(require('./command/familier'))
	.command(require('./command/serveuse'))
	.argv