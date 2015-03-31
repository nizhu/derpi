var _      = require('lodash');
var restify = require('restify');
var redis = require('redis');
var crypto = require('crypto');
var async = require('async');

var server = restify.createServer();
var client = redis.createClient();

server.use(restify.bodyParser({ mapParams: false}));

function generateU16Int(){
  return crypto.randomBytes(2).readUInt16LE(0);
};

function saveMessage(message){
  var nums = [generateU16Int(), generateU16Int()]
  client.set(nums.join(':'), message, redis.print);
  return {
    major: nums[0],
    minor: nums[1]
  };
};

function listContainsValue(key, value, callback) {
  client.lrange(key, 0, -1, function(err, values) {
    if(err) {
      callback(err)
    } else {
      callback(null, _.contains(values, value))
    }
  })

}

function saveVenue(major, minor, venueId){
  var key = major+":"+minor;
  listContainsValue("venues", venueId, function(err, contains) {
    if(!contains) {
      client.lpush("venues", venueId, redis.print);
    }
  })
  listContainsValue(venueId, key, function(err, contains) {
    if(!contains) {
      client.lpush(venueId, key, redis.print);
    }
  })
};

server.post('/message', function(req, res, next){
  console.log('Received message: ' + req.body.message);
  res.send(201, saveMessage(req.body.message));
});

server.post('/device', function(req, res, next){
  console.log('Received device: ' + req.body.major + ':' + req.body.minor + '/' + req.body.venueId);
  saveVenue(req.body.major, req.body.minor, req.body.venueId);
  res.send(201);
});

function getMessage(key, cb){
  client.get(key, function(err, message){
    cb(null, message);
  });
}

function getUsedKeys(venueId, cb) {
  client.lrange(venueId, 0, -1, cb)
}

function generateHtml(res, messages, heading) {
  var body = _(messages).compact().reduce(function(acc, message){
    return acc + '<li>'+message+'</li>';
  }, '<html><head><style>*{margin:0;padding:0}h1{color:pink;margin:20px;font-size:100px;}ul{list-style:none}body{margin:12px;text-align:center;border:5px solid teal;border-radius:5px}li{color:green;font-size:48;margin:10px}</style><script>window.setTimeout(function(){location.reload()},2000);</script></head><body><h1>'+heading+'</h1><ul>');
  res.writeHead(200, {'Content-Type':'text/html'});
  res.write(body+'</ul></body></html>')
  res.end()
}

function getUnusedKeys(callback) {
  var unusedKeys = []
  client.lrange("venues", 0, -1, function(err, venues) {
    async.map(venues, getUsedKeys, function(err, usedKeys) {
      var allTheUsedKeys = _(usedKeys).flatten().compact().value()
      client.keys("*:*", function(err, allKeys) {
        _.forEach(allKeys, function(key) {
          if(!_.contains(allTheUsedKeys, key)) {
            unusedKeys.push(key)
          }
        })
        callback(null, unusedKeys)
      })
    })
  })
}

server.post('/confirm', function(req, res, next) {
  var key = req.body.major+":"+req.body.minor;
  console.log('confirming: ', key)
  var interval = null;
  var iterations = 0;
  var checkIfUsed = function() {
    getUnusedKeys(function(err, unusedKeys) {
      if(!_.contains(unusedKeys, key)) {
        console.log(key + " is used")
        clearInterval(interval);
        res.send(200)
      } else {
        iterations++;
        console.log(key + " is not used, iteration " + iterations)
        if (iterations >= 60) {
          clearInterval(interval);
          res.send(500)
        }
      }
    })
  }
  interval = setInterval(checkIfUsed, 500)

})

server.get('/venue/:id', function(req, res, next){
  client.lrange(req.params.id, 0, -1, function(err, keys){
    async.map(keys, getMessage, function(err, messages){
      generateHtml(res, messages, 'Venue #' + req.params.id)
    });
  });
});

server.get('/unconfirmed', function(req, res, next) {
  getUnusedKeys(function(err, unusedKeys) {
    async.map(unusedKeys, getMessage, function(err, messages) {
      generateHtml(res, messages, 'Unconfirmed')
    })
  })
})

server.listen(8765, function(){
  console.log('%s listening at %s', server.name, server.url);
});

