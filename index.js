/* Glasscoin
 * Bitcoin ticker app for Glass
 * Example, primarily, but it does work.
 * Jonathan Warner, 2014
 */

// Standard modules
var http = require('http');
var url = require("url");
var fs = require('fs');

// Google API
var googleapis = require('googleapis');
var OAuth2Client = googleapis.OAuth2Client;

// dot templates
var dot = require('dot');
var cards = {
	"btc": dot.template(fs.readFileSync("cards/btc.html"))
};

// Load in the client configuration and attach to OAuth client
var config = require("./config.json");
var oauth2Client = new OAuth2Client(config.client_id, config.client_secret, config.redirect_url);

// Store global variables
var apiclient = null;
var user_card_ids = {};
var client_tokens = [];

// Attempt to load stored client tokens
try {
	var filedata = fs.readFileSync(".clienttokens.json");
	if (filedata) {
		client_tokens = JSON.parse(filedata.toString());
	}
} catch(e) {
	console.log("Info: failed to load .clienttokens.json, using blank array");
}

// read the connected users information from disk
googleapis.discover('mirror','v1').execute(function(err,client) {
	if (err) {
		console.warn("ERR: " + err.toString());
		return;
	}

	apiclient = client;

	// update cards
	getMarketData();

	// http server interface for adding clients
	http.createServer(function(req,res) {
		var u = url.parse(req.url, true)
		var s = u.pathname.split("/");

		if (s[1] == "oauth2callback") {
			oauth2Client.getToken(u.query.code, function(err,tokens) {
				if (err) {
					console.log(err);
				} else {
					client_tokens.push(tokens);
					fs.writeFileSync(".clienttokens.json", JSON.stringify(client_tokens,null,5));
					getMarketData();
				}
				res.write('Application connected. You should see the card soon on your Glass.');
				res.end();
			});
			return;
		}
		
		if (s[1] == "authorize") {
			var uri = oauth2Client.generateAuthUrl({
				access_type: 'offline',
				scope: 'https://www.googleapis.com/auth/glass.timeline',
				approval_prompt: 'force'
			});
			res.writeHead(301, { "Location": uri });
			res.end();
		} else {
			res.write('Glass Mirror API with Node. <a href="authorize">Connect to your Glass</a>');
			res.end();
		}
	}).listen(8099);
});

// download the ticker data and build data
function getMarketData() {
	http.get("http://api.bitcoinaverage.com/ticker/global/USD/", function(res) {
		var data = "";
		res.on('data', function(chunk) {
			data += chunk;
		});
		res.on('end', function() {
			var market = JSON.parse(data.toString());
			var delta = 100 * (market.last - market["24h_avg"]) / market["24h_avg"];

			updateCards({
				btclast: market.last,
				btcdelta: delta.toPrecision(3),
				avg: market['24h_avg'],
				time: market.timestamp
			});
		});
	});
}

// update all the user cards
function updateCards(data) {
	var html = cards.btc(data);
	
	for (i = 0; i < client_tokens.length; i++) {
		oauth2Client.credentials = client_tokens[i];
		apiclient.mirror.timeline.list({ "sourceItemId": "glasscoin", "isPinned": true })
		.withAuthClient(oauth2Client)
		.execute(function(err,data) {
			var apiCall;
			if (err) {
				console.log(err);
				return;
			}
			if (data && data.items.length > 0) {
				apiCall = apiclient.mirror.timeline.patch({"id": data.items[0].id }, {"html": html});
			} else {
				apiCall = apiclient.mirror.timeline.insert({
					"html": html,
					"menuItems": [
						{"action":"TOGGLE_PINNED"},
						{"action":"DELETE"}
					],
					"sourceItemId": "glasscoin"
				});
			}

			apiCall.withAuthClient(oauth2Client).execute(function(err,data) {
				console.log(err);
				console.log(data);
			});
		});
	}
}

// update every 15 minutes
setInterval(updateCards, 60 * 1000 * 15);

