const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

app.get('health', (req,res)=>res.json({status: 'ok'}));

const PORT = process.env.PORT || 4000;
app.listen(PORT, ()=>console.log(`OpenRelay server is running on port ${PORT}!!`));