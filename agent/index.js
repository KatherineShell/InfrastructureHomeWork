const express = require('express');
const app = express();
const config = require('../config');
const axios = require('axios');
const bodyParser = require('body-parser');
var cors = require('cors');
const { spawn } = require('child_process');
const path = require('path');
const rimraf = require('rimraf');
const fs = require("fs");

const urlencodedParser = bodyParser.urlencoded({ extended: true });

const fileName = config.dataFile || 'data.txt';
const agentPorts = config.agentPorts || [3001];
const parenPport = config.serverPort;
const host = config.agentHost;
const repo = config.repoUrl;

app.use(urlencodedParser);
app.use(bodyParser.json());
app.use(cors());

app.post('/build', function (request, response) {
    console.log(request.body, 'build')
    response.set('Access-Control-Allow-Origin', 'http://localhost:' + parenPport);

    let data = request.body;

    let cloneCallback = () => {
        let checkoutCallback = () => {
            let shellCallback = (stderr, stdout) => {
                endTask({
                    status: 0,
                    stderr: stderr,
                    stdout: stdout,
                    end: new Date(),
                    port: request.socket.localPort,
                    host: host,
                    ...request.body
                });
                response.status(200);
            };

            shellBuild(response, shellCallback, data, request.socket.localPort);
        };

        checkout(response, checkoutCallback, data, request.socket.localPort);
    };

    clone(response, cloneCallback, data, request.socket.localPort);
});

agentPorts.forEach(port => {

    let server = app.listen(port, host, () => {
        console.log('agent started', port);

        if (parenPport) {
            let data = {
                port: port,
                host: host
            };

            axios.post('http://localhost:' + parenPport + '/notify_agent', data, {
                headers: { 'Content-Type': 'application/json' }
            })
                .then(function (response) {
                    console.log('agent registered', port);
                })
                .catch(function (error) {
                    console.log('agent register failed', port);
                    server.close();
                });
        }
    });
});

const endTask = (data) => {
    axios.post('http://localhost:' + parenPport + '/notify_build_result', data, {
        headers: { 'Content-Type': 'application/json' }
    })
        .then(function (response) {
            console.log('agent send successfuly');
        })
        .catch(function (error) {
            console.log('agent send failed');

            fs.readFile(fileName, "utf8",
                function (error, filedata) {
                    console.log("Асинхронное чтение файла");

                    let builds = error ? [] : JSON.parse(filedata);
                    let allBuilds = [...builds, data];

                    fs.writeFile(fileName, JSON.stringify(allBuilds), function () {
                        console.log('writeFile');
                    });
                });

        })
        .finally(function () {

            rimraf(path.resolve(__dirname, '../' + data.id), function (err) {
                if (err) {
                    console.log('repo was not deleted');
                    return;
                }

                console.log('repo was deleted');
            });
        });
}

const process = (response, body, cb, command, options, params, port) => {
    let stderr, stdout;

    const childProcess = spawn(command,
        options,
        params);

    childProcess.stderr.on('data', (data) => {
        stderr += `${data}`;
        console.error(`stderr: ${data}`);
    });

    childProcess.stdout.on('data', (data) => {
        stdout += `${data}`;
        console.error(`stdout: ${data}`);
    });

    childProcess.on('close', function (code) {
        console.log('process exited with code ' + code);
        if (code == 0) {
            cb(stderr, stdout);
        }
        else {
            endTask({
                status: code,
                end: new Date(),
                ...body,
                port: port,
                host: host,
                stderr: stderr,
                stdout: stdout,
            });
            response.status(400);
        }
    });
}

const clone = (response, cb, body, port) => {
    process(response, body, cb, 'git', ['clone', repo, body.id],
        { cwd: path.resolve(__dirname, '../') }, port);
};

const checkout = (response, cb, body, port) => {
    process(response, body, cb, 'git', ['checkout', body.hash],
        { cwd: path.resolve(__dirname, '../' + body.id) }, port);
};

const shellBuild = (response, cb, body, port) => {
    process(response, body, cb, body.command, [],
        { cwd: path.resolve(__dirname, '../' + body.id), shell: true }, port);
};