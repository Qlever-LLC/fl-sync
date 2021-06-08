const WebSocket = require('ws');


let ws = new WebSocket('wss://sandbox.foodlogiq.com/v2/ws/businesses/5acf7c2cfd7fa00001ce518d/links/assessment/60b7ee08ae33d9000ee14d1c', {
  Origin: 'https://sandbox.foodlogiq.com',
  //Authentication: 'Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJodHRwczovL2Zvb2Rsb2dpcS5hdXRoMC5jb20vIiwic3ViIjoiYXV0aDB8NWRmNTQxMDk4YmExNmIwZGExZjBjNmE4IiwiYXVkIjoiQnpzY0I5NXVGVTlSdkFGQzFGM0I0eFVVSWtiV0NSTmgiLCJpYXQiOjE1NzYzNjcyMzQsImV4cCI6MTU3NjM2NzUzNH0.tcWWHxyKlKlv7FNm1nferzTe6BgwiXY4ZgYSZv9z_wg',
  Host: 'sandbox.foodlogiq.com',
  'Sec-WebSocket-Version': 13,
//  'Sec-WebSocket-Key': '5Bv8eztIFk4+rOQ6kl/COA==',
  Connection: 'Upgrade',
  Upgrade: 'websocket'
});

ws.on('open', function open() {
  console.log('connected');
});
/*
ws.on('headers', function heads(headers) {
  console.log('headers', headers);
  ws.send(headers);
});
*/

ws.on('close', function close() {
  console.log('disconnected');
});

ws.on('error', function errored(err) {
  console.log('errored', err);
});

ws.on('message', function incoming(data) {
  console.log(`Roundtrip time: ${Date.now() - data} ms`);
});
