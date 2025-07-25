const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');

require('dotenv').config();

const uri = process.env.MONGODB_URI;
const mongoose = require("mongoose");
mongoose.connect(uri)
  .then(() => console.log("Mongo DB connected"))
  .catch(err => console.log(err));

const app = express();
app.use(cors());
app.use(bodyParser.json()); // Changed from bodyParser.tsxon()

app.use((req, res, next) =>
{
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'Origin, X-Requested-With, Content-Type, Accept, Authorization'
    );
    res.setHeader(
        'Access-Control-Allow-Methods',
        'GET, POST, PATCH, DELETE, OPTIONS'
    );
    next();
});

var api = require('./api.js');
api.setApp( app, mongoose );

app.listen(5000); // start Node + Express server on port 5000