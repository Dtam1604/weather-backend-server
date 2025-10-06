const express = require('express');
const axios = require('axios');
const { createClient } = require('@vercel/kv');
require('dotenv').config(); 

const app = express();
app.use(express.json());

const WEATHER_API_KEY = process.env.WEATHER_API_KEY;
const BASE_URL = 'https://api.weatherapi.com/v1';
const CACHE_TTL_SECONDS = 5 * 60; // 5 phút = 300 giây

// ----------------------------------------------------------------------
// LOGIC PHÂN TÍCH VÀ KHỞI TẠO KV CLIENT AN TOÀN
// ----------------------------------------------------------------------
let kv = null;

// Lấy chuỗi kết nối Redis URI đầy đủ (chứa cả token và host)
const fullRedisUri = process.env.REDIS_URL || null;

if (fullRedisUri) {
    try {
        // Phân tích URI để trích xuất host/port và password/token
        // Ví dụ: redis://default:TOKEN@HOST:PORT
        const urlObj = new URL(fullRedisUri);
        
        // 1. Trích xuất Token (mật khẩu)
        // user:password -> password
        const kvToken = urlObj.password; 
        
        // 2. Tạo URL REST API (HTTPS) từ host và port
        const kvHost = urlObj.hostname;
        const kvPort = urlObj.port;
        
        // Tạo URL REST API ở định dạng HTTPS mà @vercel/kv yêu cầu
        // LƯU Ý: Nếu không có port, thư viện sẽ mặc định dùng port 443 (HTTPS)
        let kvRestUrl = `https://${kvHost}`;
        if (kvPort) {
            kvRestUrl += `:${kvPort}`;
        }
        
        if (kvToken) {
            kv = createClient({
                url: kvRestUrl,
                token: kvToken,
            });
            console.log("KV Client initialized successfully using parsed REDIS_URL.");
        } else {
            // Trường hợp không có token trong URI (rất hiếm)
            console.error("CRITICAL ERROR: Token missing in REDIS_URL.");
        }
        
    } catch (error) {
        console.error("CRITICAL ERROR: Failed to parse REDIS_URL or initialize KV client:", error.message);
        kv = null; 
    }
} else {
    console.warn("REDIS_URL is missing. KV caching is disabled.");
}

// ----------------------------------------------------------------------
// Hàm tiện ích gọi WeatherAPI (Giữ nguyên)
// ----------------------------------------------------------------------
async function callWeatherApi(endpoint, queryParams) {
    if (!WEATHER_API_KEY) {
        // Ném lỗi rõ ràng nếu thiếu API Key
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
    if (kv) { // KIỂM TRA ĐẢM BẢO KV ĐÃ KHỞI TẠO
        try {
            const cachedData = await kv.get(cacheKey); 
            if (cachedData) {
                console.log(`[CACHE HIT] Trả về dữ liệu Cache KV cho ${q}.`);
                return res.status(200).json(cachedData);
            }
        } catch (cacheError) {
            // Lỗi ở đây là lỗi mạng (fetch failed) hoặc kết nối, không làm sập hàm
            console.error(`[CACHE ERROR] Không thể truy cập KV: ${cacheError.message}`);
        }
    }

    // --- BƯỚC 2: CACHE MISS: GỌI API BÊN THỨ 3 ---
    console.log(`[CACHE MISS] Gọi API bên thứ 3 cho ${q}.`);
    const { status, data } = await callWeatherApi('current', { q, aqi: 'yes' });
    
    // --- BƯỚC 3: LƯU VÀO CACHE NẾU GỌI THÀNH CÔNG ---
    if (status === 200) {
        if (kv) { // KIỂM TRA ĐẢM BẢO KV ĐÃ KHỞI TẠO
            try {
                // Dùng kv.set để lưu dữ liệu và đặt TTL (thời gian sống) là 5 phút
                await kv.set(cacheKey, data, { ex: CACHE_TTL_SECONDS });
                console.log(`[CACHE STORED] Đã lưu dữ liệu mới cho ${q} vào KV với TTL=${CACHE_TTL_SECONDS}s.`);
            } catch (storeError) {
                console.error(`[CACHE ERROR] Không thể lưu vào KV: ${storeError.message}`);
            }
        } else {
            console.warn(`[CACHE DISABLED] Dữ liệu không được lưu vào KV do lỗi khởi tạo.`);
        }
    }
    
    // Trả về kết quả
    res.status(status).json(data);
});

// ----------------------------------------------------------------------
// CÁC ENDPOINT KHÁC VÀ EXPORT
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
        status: "OK"
    });
});

module.exports = app;