const express = require('express');
const axios = require('axios');
// IMPORT THƯ VIỆN VERCEL KV
const { createClient } = require('@vercel/kv');
require('dotenv').config(); 

const app = express();
app.use(express.json());

const WEATHER_API_KEY = process.env.WEATHER_API_KEY;
const BASE_URL = 'https://api.weatherapi.com/v1';
const CACHE_TTL_SECONDS = 5 * 60; // 5 phút = 300 giây

// ----------------------------------------------------------------------
// KHỞI TẠO VERCEL KV CLIENT AN TOÀN
// Sử dụng KV_REST_API_URL và KV_REST_API_TOKEN do Vercel cung cấp
// ----------------------------------------------------------------------
let kv = null;
const kvUrl = process.env.KV_REST_API_URL;
const kvToken = process.env.KV_REST_API_TOKEN;

if (kvUrl && kvToken) {
    try {
        kv = createClient({
            url: kvUrl,
            token: kvToken,
        });
        console.log("KV Client initialized successfully with Vercel KV.");
    } catch (error) {
        // Nếu khởi tạo lỗi (rất hiếm khi xảy ra với tích hợp), đặt kv về null
        console.error("CRITICAL ERROR: Failed to initialize KV client:", error.message);
        kv = null; 
    }
} else {
    console.warn("KV_REST_API_URL or KV_REST_API_TOKEN is missing. KV caching is disabled.");
}

// ----------------------------------------------------------------------
// Hàm tiện ích gọi WeatherAPI 
// ----------------------------------------------------------------------
async function callWeatherApi(endpoint, queryParams) {
    if (!WEATHER_API_KEY) {
        throw new Error("WEATHER_API_KEY is not configured. Check Vercel Environment Variables.");
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
    if (kv) { // Chỉ chạy nếu KV được khởi tạo thành công
        try {
            const cachedData = await kv.get(cacheKey); 
            if (cachedData) {
                console.log(`[CACHE HIT] Trả về dữ liệu Cache KV cho ${q}.`);
                return res.status(200).json(cachedData);
            }
        } catch (cacheError) {
            // Log lỗi (thường là fetch failed), nhưng cho phép request tiếp tục
            console.error(`[CACHE ERROR] Không thể truy cập KV: ${cacheError.message}`);
        }
    }

    // --- BƯỚC 2: CACHE MISS: GỌI API BÊN THỨ 3 ---
    console.log(`[CACHE MISS] Gọi API bên thứ 3 cho ${q}.`);
    const { status, data } = await callWeatherApi('current', { q, aqi: 'yes' });
    
    // --- BƯỚC 3: LƯU VÀO CACHE NẾU GỌI THÀNH CÔNG ---
    if (status === 200) {
        if (kv) { // Chỉ lưu nếu KV được khởi tạo thành công
            try {
                await kv.set(cacheKey, data, { ex: CACHE_TTL_SECONDS });
                console.log(`[CACHE STORED] Đã lưu dữ liệu mới cho ${q} vào KV với TTL=${CACHE_TTL_SECONDS}s.`);
            } catch (storeError) {
                // Log lỗi lưu (thường là fetch failed), nhưng không làm ảnh hưởng response
                console.error(`[CACHE ERROR] Không thể lưu vào KV: ${storeError.message}`);
            }
        }
    }
    
    // Trả về kết quả
    res.status(status).json(data);
});

// ----------------------------------------------------------------------
// CÁC ENDPOINT KHÁC (Chuyển tiếp API)
// ----------------------------------------------------------------------
app.get('/api/forecast', async (req, res) => {
    const { q, days } = req.query;
    if (!q) return res.status(400).json({ error: "Thiếu tham số 'q'." });
    const forecastDays = days && !isNaN(parseInt(days)) ? parseInt(days) : 5; 
    const { status, data } = await callWeatherApi('forecast', { q, days: forecastDays, aqi: 'yes', alerts: 'yes' });
    res.status(status).json(data);
});

app.get('/api/search', async (req, res) => {
    const { q } = req.query;
    if (!q) return res.status(400).json({ error: "Thiếu tham số 'q'." });
    const { status, data } = await callWeatherApi('search', { q });
    res.status(status).json(data);
});

app.get('/', (req, res) => {
    res.status(200).json({
        message: "Weather Proxy API is running on Vercel with Smart Caching.",
        note: "Caching is handled by Vercel KV for 5 minutes.",
        status: "OK"
    });
});

// ----------------------------------------------------------------------
// XUẤT MODULE CHO VERCEL (BẮT BUỘC)
// ----------------------------------------------------------------------
module.exports = app;