# curly-js

a request module for browser javascript using cascading syntax  
more examples are coming but curly just exposes all the http methods and you config it using cascades.

``` js
var curly = require('curly'); // we use a common.js loader in this example

curly.get('/example', callback);
curly.get('/example').send(callback); // above is sugar for this

curly.get('/example')
	 .query({hello:'world'}, callback); // adds a query string

curly.get('https://some-json-service.com')
	 .query({meh:'bar'})
	 .json(callback); // we expect json back

curly.post('/myapp')
	 .timeout(2000)
	 .json({hello:'world'}, callback); // request must take less than 2s and we send and expect json

```

besides `get` and `post` curly supports `put` and `del`.  