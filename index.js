#!/usr/bin/env node
const login = require('./login')
const prompts = require('prompts')
const qs = require('querystring')
const mime = require('mime-types')
const { CookieJar } = require('tough-cookie')
const got = require('got')
const FormData = require('form-data')
const cheerio = require('cheerio')
const fs = require('fs-extra')
const path = require('path')

const REPOURL = 'https://github.com/isaacs/github/issues/new'
const COOKIEFILE = path.join(__dirname, 'cookie.json')
const FILEPATH = path.join(process.cwd(), process.argv[2])

const readCookie = async () => {
	if (await fs.exists(COOKIEFILE)) {
		// if cookie already exists
		return CookieJar.fromJSON(await fs.readFile(COOKIEFILE, 'utf-8'))
	}

	const questions = [
		{
			type: 'text',
			name: 'username',
			message: 'What is your GitHub username?',
			validate: v => !!v
		},
		{
			type: 'password',
			name: 'password',
			message: 'What is your GitHub password?',
			validate: v => !!v
		},
		{
			type: 'confirm',
			name: 'has2fa',
			message: 'Do you have 2fa?'
		},
		{
			type: has2fa => (has2fa ? 'text' : null),
			name: 'otp',
			message: 'Please tell me your current otp code.',
			validate: v => !!v
		}
	]
	const r = await prompts(questions)
	const cookie = await login(r.username, r.password, r.otp)
	await fs.writeFile(COOKIEFILE, JSON.stringify(cookie.toJSON()))
	return cookie
}
;(async () => {
	const cookieJar = await readCookie()
	const client = got.extend({
		cookieJar,
		followRedirect: false,
		hooks: {
			beforeRequest: opts => {
				//console.log(opts)
				if (opts.form) {
					opts.body = qs.stringify(opts.form)
					opts.headers['Content-Length'] = opts.body.length
				}
			}
		}
	})
	const $ = await client.get(REPOURL).then(r => cheerio.load(r.body))
	const stat = await fs.stat(FILEPATH)
	try {
		const res = await client
			.post('https://github.com/upload/policies/assets', {
				form: {
					name: path.basename(FILEPATH),
					size: stat.size,
					content_type: mime.lookup(FILEPATH),
					authenticity_token: $('.js-upload-markdown-image').data('upload-policy-authenticity-token'),
					repository_id: parseInt($('meta[name="octolytics-dimension-repository_id"]').attr('content'))
				}
			})
			.then(r => JSON.parse(r.body))
			.catch(e => {
				throw JSON.parse(e.body)
			})
		const fd = new FormData()
		for (const [k, v] of Object.entries(res.form)) {
			fd.append(k, v)
		}
		fd.append('file', fs.createReadStream(FILEPATH))
		await client.post(res.upload_url, { body: fd })
		const fd2 = new FormData()
		fd2.append('authenticity_token', res.asset_upload_authenticity_token)
		const result = await client
			.put('https://github.com' + res.asset_upload_url, { headers: { Accept: 'application/json' }, body: fd2 })
			.then(r => JSON.parse(r.body))
		console.log(result)
	} catch (e) {
		if (e.errors) {
			console.error(e.errors)
		} else {
			console.error(e)
		}
	}
})().catch(console.error)
