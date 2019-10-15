const express = require('express');
const app = express();
const fs = require("fs");
const bodyParser = require('body-parser');
var cors = require('cors');
const axios = require('axios');
const config = require('../config');
const urlencodedParser = bodyParser.urlencoded({ extended: true });

let agents = [];
let taskQueue = [];

const port = config.serverPort || 3000;
const fileName = config.dataFile || 'data.txt';

app.use(urlencodedParser);
app.use(bodyParser.json());
app.use(cors());

app.get('/', function (request, response) {
    console.log('sendFile index');

    fs.readFile(fileName, "utf8",
        function (error, data) {
            console.log("Асинхронное чтение файла");
            console.log(agents, 'agents')

            let builds = error ? [] : JSON.parse(data);
            let arrayHtml = '';

            builds.forEach(element => {
                let style = element.status === 0 ? `"color: #28a745;"` : `"color: #dc3545;"`;
                let click = ` onclick="window.location.pathname='/build/` + element.id + `'" `;

                arrayHtml += `<tr>
                  <th `+ click + ` >` + element.hash + `</th>
                  <td `+ click + ` >` + element.start + `</td>
                  <td `+ click + ` >` + element.end + `</td>
                  <td `+ click + ` style=` + style + ` >` + element.status + `</td>
                  <td `+ click + ` >` + element.command + `</td>
              </tr>`;
            });

            let content = `<div class="form-group mb-2 mt-2 form-inline">
            <input id="command" value="npm run build" required type="text" class="form-control mx-sm-4" placeholder="Command">
            <input id="hash" value="react" type="text" required class="form-control mx-sm-4" placeholder="Commit Hash">
            <button onclick="sendRequest(event)" id="build" class="btn btn-primary">Build</button>
        </div>
                <table class="table">
                    <thead>
                        <tr>
                            <th scope="col">Commit hash</th>
                            <th scope="col">Start Date</th>
                            <th scope="col">End Date</th>
                            <th scope="col">Status</th>
                            <th scope="col">Build command</th>
                        </tr>
                    </thead>
                    <tbody>`+ arrayHtml + `</tbody>
                </table>`;

            let script = `<script src="https://unpkg.com/axios/dist/axios.min.js"></script>
                <script>
        function sendRequest(event) {
            let command = document.getElementById('command').value;
            let hash = document.getElementById('hash').value;
            event.preventDefault();
            axios.post('http://localhost:` + port + `/manage_task', {
                        hash: hash,
                        command: command
                    },
                    {
                        headers:{
                            "Accept": "application/json",
                            "Access-Control-Allow-Origin": "*",
                            "X-Requested-With": "XMLHttpRequest",
                            "Access-Control-Allow-Methods" : "GET,POST,PUT,DELETE,OPTIONS",
                            "Access-Control-Allow-Headers": "Origin, Content-Type, Access-Control-Allow-Headers, X-Requested-With"
                          }
                    })
                        .then(function (response) {
                            console.log(response, 'response');
                        })
                        .catch(function (error) {
                            console.log(error, 'error');
                        });
        }
                </script>`;

            response.send(layout.replace('{{content}}', content).replace('{{script}}', script));
        });
});

app.get('/build/:buildId', function (request, response) {
    let buildId = request.params['buildId'];
    console.log('sendFile build');

    readFileData((builds) => {
        let build = builds.find(el => el.id == buildId);
        let style = build.status === 0 ? `"color: #28a745;"` : `"color: #dc3545;"`;

        let content = ` <table class="table">
            <thead>
                <tr>
                    <th scope="col">Commit hash</th>
                    <th scope="col">Start Date</th>
                    <th scope="col">End Date</th>
                    <th scope="col">Status</th>
                    <th scope="col">Build command</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <th scope="row">`+ build.hash + `</th>
                    <td>`+ build.start + `</td>
                    <td>`+ build.end + `</td>
                    <td style=`+ style + ` >` + build.status + `</td>
                    <td>`+ build.command + `</td>
                </tr>
            </tbody>
        </table>
        <div class="m-4">
        <h4 >stderr</h4>
        <div>` + build.stderr + `</div>
        </div>
        <div class="m-4">
        <h4 >stdout</h4>
        <div>` + build.stdout + `</div>
        </div>`;

        build && response.send(layout.replace('{{content}}', content).replace('{{script}}', ''));
    });
});

app.post('/manage_task', function (request, response) {
    console.log('/manage_task');
    let responseData = request.body;

    if (!responseData) return response.sendStatus(400);

    let freeAgentIndex = agents.findIndex(el => el.isFree);

    if (freeAgentIndex < 0) {
        taskQueue.push({
            hash: responseData.hash,
            command: responseData.command
        });
        return;
    }

    let agent = agents[freeAgentIndex];

    agents[freeAgentIndex].isFree = false;

    sendTask(agent, responseData);
});

app.post('/notify_agent', function (request, response) {
    console.log('/notify_agent');
    if (!request.body) return response.sendStatus(400);

    let { port, host } = request.body;
    let newAgent;
    let agentIndex = agents.findIndex(el => el.port === port);
    let taskLen = taskQueue.length;

    if (agentIndex < 0) {
        newAgent = { host: host, port: port, isFree: taskLen === 0 };
        agents.push(newAgent);
    }
    else {
        agents[agentIndex].isFree = taskLen === 0;
        newAgent = agents[agentIndex];
    }

    if (taskQueue.length > 0) {
        let firstTask = taskQueue.shift();

        sendTask(newAgent, firstTask);
    }

    console.log(agents, 'agents')
    response.sendStatus(200);
});

app.post('/notify_build_result', function (request, response) {
    let agentResponse = request.body;
    console.log('/notify_build_result');
    if (!agentResponse) return response.sendStatus(400);

    let { port, host } = agentResponse;
    let currentAgentIndex = agents.findIndex(el => el.port === port);

    agents[currentAgentIndex].isFree = taskQueue.length === 0;

    if (taskQueue.length > 0) {
        let firstTask = taskQueue.shift();

        sendTask(agents[currentAgentIndex], firstTask);
    }

    readFileData((builds) => {
        let allBuilds = [...builds, agentResponse];

        fs.writeFile(fileName, JSON.stringify(allBuilds), function () {
            console.log('writeFile');
        });
    });

    console.log(agents, 'agents')

    response.sendStatus(200);
});

app.listen(port, () => { console.log('server started'); });

const readFileData = (cb) => {
    fs.readFile(fileName, "utf8",
        function (error, data) {
            console.log("Асинхронное чтение файла");

            let builds = error ? [] : JSON.parse(data);

            cb(builds);
        });
};

const sendTask = (agent, responseData) => {

    axios.post('http://' + agent.host + ':' + agent.port + '/build', {
        hash: responseData.hash,
        command: responseData.command,
        start: new Date(),
        id: (~~(Math.random() * 1e8)).toString(16)
    },
        {
            headers: {
                "Accept": "application/json",
                "Access-Control-Allow-Origin": "*",
                "X-Requested-With": "XMLHttpRequest",
                "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
                "Access-Control-Allow-Headers": "Origin, Content-Type, Access-Control-Allow-Headers, X-Requested-With"
            }
        }
    )
        .then(function (response) {
            console.log('build response');
        })
        .catch(function (error) {
            console.log('build error');
        });
};

const layout = `<!DOCTYPE html>
<html>
<head>
    <base href="/" />
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, maximum-scale=1.0, minimum-scale=1.0">
    <title>Infrastructure</title>
    <link rel="stylesheet" href="https://stackpath.bootstrapcdn.com/bootstrap/4.3.1/css/bootstrap.min.css"
        integrity="sha384-ggOyR0iXCbMQv3Xipma34MD+dH/1fQ784/j6cY/iJTQUOhcWr7x9JvoRxT2MZw1T" crossorigin="anonymous">
</head>
<body>
    <div>
    {{content}}
    </div>
</body>
{{script}}
</html>`;