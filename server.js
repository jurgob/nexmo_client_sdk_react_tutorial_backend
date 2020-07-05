const express = require('express');
const dotenv = require('dotenv');
const bunyan = require('bunyan');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const logger = bunyan.createLogger({ name: 'myapp' });
const path = require('path');
const { base64encode } = require('nodejs-base64');
const {generateBEToken,generateUserToken,getStaticConfig} = require('./utils');
var cors = require('cors')


const bodyParser = require('body-parser');


function createApp(config) {

  const app = express()
  app.use(bodyParser.json())
  app.use(cors())


  app.use((req, res, next) => {
    const { query, baseUrl, originalUrl, url, method, statusCode, body } = req
    logger.info({ query, baseUrl, originalUrl, url, method, statusCode, body }, "Request Logger:: ")
    next()
  })

  app.get('/ping', (req, res) => res.json({ success: true}))
  app.post('/voiceEvent', (req, res) => res.json({ body: req.body }))


  const nccoHandler = (req, res) => {
    const { to = 'unknown', from = 'unknown', dtmf = -1 } = req.query;

    let ncco = [
      {
        "action": "talk",
        "text": `Hello There, your number is ${to.split("").join("  ")} and you are colling ${from.split("").join(" ")}`
      }
    ]

    const toSplitted = to.split('__')
    if(toSplitted[0] === 'ncco'){
      if(toSplitted[1] === 'talk'){
        ncco = [
          {
            "action": "talk",
            "text": toSplitted[2]
          }
        ]
      }
    }



    logger.info({ ncco }, "NCCO Logger:: ")

    return res.json(ncco)

  }

  app.get('/ncco', nccoHandler)

  const tokenCreation = (req, res) => {
    const { username } = req.params;

    const jsonResponse = {
      username,
      token: generateUserToken({config, user_name: username})
    }

    return res.json(jsonResponse)

  }

    app.post('/tokens/:username', tokenCreation)


  return app;
}




function localDevSetup({ config }) {
  const { port, application_id, application_name, nexmo_account,isDev } = config;

  if(!isDev)
  return Promise.resolve({
    config
  });

  const ngrok = require('ngrok');
  let NGROK_URL;
  const {api_key, api_secret } = nexmo_account;
  const dev_api_token = base64encode(`${api_key}:${api_secret}`)
  return ngrok.connect(port)
    .then((ngrok_url) => {
      NGROK_URL = ngrok_url;
      return axios({
        method: "PUT",
        url: `https://api.nexmo.com/v2/applications/${application_id}`,
        data: {
          "name": application_name,
          "capabilities": {
            "voice": {
              "webhooks": {
                "answer_url": {
                  "address": `${ngrok_url}/ncco`,
                  "http_method": "GET"
                },
                "event_url": {
                  "address": `${ngrok_url}/voiceEvent`,
                  "http_method": "POST"
                }
              }
            }
          }
        },
        headers: { 'Authorization': `basic ${dev_api_token}` }
      })
        .then(({ data, status }) => {
          logger.info({ data, status })
        })
    })
    .then(() => ({
      config: {
        ...config,
        server_url: NGROK_URL
      }
    }))
}


function checkEnvVars(){
  const isDev = !process.env.NODE_ENV
  if(isDev)
    dotenv.config();

  let mandatoryEnvs = ["MY_NEXMO_APP_PRIVATE_KEY", "MY_NEXMO_APP_APPLICATION_ID", "MY_NEXMO_APP_APPLICATION_NAME", "MY_NEXMO_APP_API_KEY"]
  if(isDev)
    mandatoryEnvs = mandatoryEnvs.concat(["MY_NEXMO_APP_API_KEY", "MY_NEXMO_APP_API_SECRET"])


  const getEmpty = (acc, cur) => {
    if(!process.env[cur]) {
      return [...acc, cur]
    } else {
      return acc
    }
  }
  const emptyEnvs = mandatoryEnvs
  .reduce(getEmpty, [])


  return emptyEnvs


}


function listenServer({ app, config }) {
  const { port } = config;
  return new Promise((resolve) => {
    return app.listen(port, () => resolve({ config }))
  })
}

//
function bindLvnToApp({phone_number, application_id, api_key, api_secret}){
  //`msisdn=${phone_number}&voiceCallbackValue=${application_id}&api_key=${api_key}&api_secret=${api_secret}`
  const data = `country=GB&msisdn=${phone_number}&moHttpUrl=&voiceCallbackType=app&voiceCallbackValue=${application_id}&api_key=${api_key}&api_secret=${api_secret}`
  return axios({
        method: "POST",
        url: `https://rest.nexmo.com/number/update`,
        data,
        headers: { 'Content-Type': `application/x-www-form-urlencoded` }
      })
      .then(({ data, status }) => {
          logger.info({ data, status })
        })
}

function startServer() {
  dotenv.config();
  const staticConfig = getStaticConfig(process.env)
  const {phone_number, application_id, nexmo_account} = staticConfig;
  const {api_key, api_secret} = nexmo_account;
  return Promise.resolve()
    .then(() => bindLvnToApp({phone_number, application_id, api_key, api_secret}))
    .then(() => localDevSetup({ config: staticConfig }))
    .then(({ config }) => {
      const app = createApp(config)
      return { config, app }
    })
    .then(({ app, config }) => listenServer({ app, config }))
    .then(({ config }) => {
      const { port } = config;
      logger.info(`config`, config)
      logger.info(`Example app listening on port ${port}!`)
    })
}

const  emptyEnvs = checkEnvVars();
if(emptyEnvs.length)
  logger.error(`you need to configure the following vars`, emptyEnvs)
else
  startServer()
    .catch(err => console.error(err))
