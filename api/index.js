const express = require('express');
const axios = require('axios');
// IMPORT THƯ VIỆN VERCEL KV (ĐỂ CACHE ONL)
const { createClient } = require('@vercel/kv'); // Cần @vercel/kv
require('dotenv').config(); 

const app = express();
app.use(express.json());

const WEATHER_API_KEY = process.env.WEATHER_API_KEY;
const BASE_URL = 'https://api.weatherapi.com/v1';
const CACHE_TTL_SECONDS = 5 * 60; // 5 phút = 300 giây

// KHỞI TẠO VERCEL KV CLIENT
// Các biến môi trường sẽ được Vercel tự động cung cấp
const kv = createClient({
    // url: process.env.KV_REST_API_URL,
    // token: process.env.KV_REST_API_TOKEN,
    url: process.env.REDIS_URL,
});

// ----------------------------------------------------------------------
// Hàm tiện ích gọi WeatherAPI (Giữ nguyên)
// ----------------------------------------------------------------------
async function callWeatherApi(endpoint, queryParams) {
    if (!WEATHER_API_KEY) {
        throw new Error("WEATHER_API_KEY is not configured.");
    }
    const params = new URLSearchParams({
        ...queryParams,
        key: WEATHER_API_KEY,
        lang: 'vi' 
    }).toString();
    const fullUrl = `${BASE_URL}/${endpoint}.json?${params}`;
    
    try {
        const response = await axios.get(fullUrl);
        return { status: 200, data: response.data };
    } catch (error) {
        const status = error.response ? error.response.status : 500;
        const data = error.response ? error.response.data : { code: 'API_ERROR', message: "Internal server error." };
        return { status: status, data: data };
    }
}

// ----------------------------------------------------------------------
// ENDPOINT 1: Xem thời tiết hiện tại (/api/current) - KV CACHING
// ----------------------------------------------------------------------
app.get('/api/current', async (req, res) => {
    const { q } = req.query; 
    if (!q) return res.status(400).json({ error: "Thiếu tham số 'q'." });

    const cacheKey = q.toLowerCase().trim();

    // --- BƯỚC 1: KIỂM TRA CACHE TRONG KV STORE ---
    try {
        // Dùng kv.get để lấy dữ liệu cache từ dịch vụ bên ngoài
        const cachedData = await kv.get(cacheKey); 

        if (cachedData) {
            console.log(`[CACHE HIT] Trả về dữ liệu Cache KV cho ${q}.`);
            return res.status(200).json(cachedData);
        }
    } catch (cacheError) {
        // Log lỗi cache, nhưng không chặn request
        console.error(`[CACHE ERROR] Không thể truy cập KV: ${cacheError.message}`);
    }

    // --- BƯỚC 2: CACHE MISS: GỌI API BÊN THỨ 3 ---
    console.log(`[CACHE MISS] Gọi API bên thứ 3 cho ${q}.`);
    const { status, data } = await callWeatherApi('current', { q, aqi: 'yes' });
    
    // --- BƯỚC 3: LƯU VÀO CACHE NẾU GỌI THÀNH CÔNG ---
    if (status === 200) {
        try {
            // Dùng kv.set để lưu dữ liệu và đặt TTL (thời gian sống) là 5 phút
            await kv.set(cacheKey, data, { ex: CACHE_TTL_SECONDS });
            console.log(`[CACHE STORED] Đã lưu dữ liệu mới cho ${q} vào KV với TTL=${CACHE_TTL_SECONDS}s.`);
        } catch (storeError) {
            console.error(`[CACHE ERROR] Không thể lưu vào KV: ${storeError.message}`);
        }
    }
    
    // Trả về kết quả
    res.status(status).json(data);
});

// ----------------------------------------------------------------------
// CÁC ENDPOINT KHÁC (GIỮ NGUYÊN)
// ----------------------------------------------------------------------
app.get('/api/forecast', async (req, res) => {
    // ... logic chuyển tiếp API forecast
    const { q, days } = req.query;
    if (!q) return res.status(400).json({ error: "Thiếu tham số 'q'." });
    const forecastDays = days && !isNaN(parseInt(days)) ? parseInt(days) : 5; 
    const { status, data } = await callWeatherApi('forecast', { q, days: forecastDays, aqi: 'yes', alerts: 'yes' });
    res.status(status).json(data);
});

app.get('/api/search', async (req, res) => {
    // ... logic chuyển tiếp API search
    const { q } = req.query;
    if (!q) return res.status(400).json({ error: "Thiếu tham số 'q'." });
    const { status, data } = await callWeatherApi('search', { q });
    res.status(status).json(data);
});

app.get('/', (req, res) => {
    res.status(200).json({
        message: "Weather Proxy API is running on Vercel with Vercel KV Smart Caching.",
        note: "Data is cached externally for 5 minutes.",
        status: "OK"
    });
});

// ----------------------------------------------------------------------
// XUẤT MODULE CHO VERCEL (BẮT BUỘC)
// ----------------------------------------------------------------------
module.exports = app;