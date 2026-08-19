const express = require('express');
const router = express.Router();
const pool = require('../config/db');

router.get('/', (req, res) => res.json({ status: 'all good :)' }));

router.get('/db', async (req,res)=>{
    try{
        const result = await pool.query('SELECT NOW()');
        res.json({db: 'connected', time: result.rows[0].now });
    }catch(err){
        res.status(500).json({db: 'error', message: err.message });
    }
});

module.exports = router;