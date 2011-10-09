var server = require('router').create();
var bark = require('bark');
var parseURL = require('url').parse;

server.get('/', bark.file('./example.html'));
server.get('/proxy', bark.file('../proxy.html'));
server.get('/post', bark.file('./post.html'));
server.get('/ua', function(request, response) {
	var callback = parseURL(request.url, true).query.callback;

	response.writeHead(200, {'content-type':'application/javascript'});
	response.end(callback+'('+JSON.stringify(request.headers['user-agent'])+');')
});
server.get('/time', function(request, response) {
	response.writeHead(200, {'content-type':'application/json'});
	response.end(''+Date.now());
});

server.listen(7777);
