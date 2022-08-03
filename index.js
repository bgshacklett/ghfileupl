#!/usr/bin/env node

const url = require('url');
const https = require('https');
const mime = require('mime-types')
const FormData = require('form-data')
const cheerio = require('cheerio')
const fs = require('fs-extra')
const path = require('path')
const { program } = require('commander');
const { Octokit, App } = require("octokit");

const ALLOWED_FILETYPES = [
  '.gif',
  '.jpg',
  '.jpeg',
  '.png',
  '.docx',
  '.gz',
  '.log',
  '.pdf',
  '.pptx',
  '.txt',
  '.xlsx',
  '.zip',
]


program
  .name('ghfileupl')
  .option('--github-url <string>', 'The URL to your GitHub instance')
  .requiredOption('--filepath <string>', 'The file to upload')
  .requiredOption('--repository <string>', 'The GitHub repository');

program.parse();

const opts = program.opts();

const githubToken = process.env.GITHUB_TOKEN

const githubUrl = process.env.GITHUB_URL
  || opts.githubUrl
  || 'https://github.com'

// Create a personal access token at https://github.com/settings/tokens/new?scopes=repo
const client = new Octokit({
  userAgent: 'Github File Uploader/0.0.1 GHE-enabled https://github.com/bgshacklett/ghfileupl',
  auth: githubToken,
  baseUrl: githubUrl,
});

const repoUrl = new url.URL(`${githubUrl}/${opts.repository}`)

// Validate URL (sorta)
const req = https.get(repoUrl, () => {});
req.on('error', error => { console.error(error); });
req.end();





const FILEPATH = path.resolve(opts.filepath)
const fileext = path.extname(FILEPATH)


if (!ALLOWED_FILETYPES.includes(fileext)) {
  console.log('Your file is not allowed to upload to GitHub.')
  console.log(`Only ${ALLOWED_FILETYPES.join(', ')} are allowed.`)
  process.exit(1)
}

(async () => {
  // Insert Octokit here.
  const $ = await client.get(repoUrl).then(r => cheerio.load(r.body))
  const stat = await fs.stat(FILEPATH)
  try {
    const res = await client
      .post('https://github.com/upload/policies/assets', {
        form: {
          name: path.basename(FILEPATH),
          size: stat.size,
          content_type: mime.lookup(FILEPATH),
          authenticity_token: $('.js-upload-markdown-image').children('input[type=hidden]').attr('value'),
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
    console.log(JSON.stringify(result, null, 2))
  } catch (e) {
    if (e.errors) {
      program.error(e.errors)
    } else {
      program.error(e)
    }
  }
})().catch(program.error)
