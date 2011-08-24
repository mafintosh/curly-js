var server = require('router').create();

server.options(function(request, response) {
	response.writeHead(200, {'access-control-allow-origin':'*', 'access-control-request-method':'GET, POST, PUT, DELETE', 'access-control-request-headers':'Content-Type'});
	response.end();
});
server.get('/json', function(request, response) {
	response.writeHead(200, {'access-control-allow-origin':'*'});
	response.end(JSON.stringify({now:Date.now()}));
});
server.post('/json', function(request, response) {
	response.writeHead(200, {'access-control-allow-origin':'*'});
	request.pipe(response);
});

server.listen(4455);
