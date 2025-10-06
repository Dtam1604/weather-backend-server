const express = require('express');
const axios = require('axios');
require('dotenv').config(); 

const app = express();
// DÒNG QUAN TRỌNG: Cấu hình Pretty Print (in đẹp) với 2 khoảng trắng
app.set('json spaces', 2); 
app.use(express.json());

const WEATHER_API_KEY = process.env.WEATHER_API_KEY;
const BASE_URL = 'https://api.weatherapi.com/v1';

// ----------------------------------------------------------------------
// Hàm tiện ích gọi WeatherAPI (Không Lọc Dữ Liệu & Thêm Tiếng Việt)
// ----------------------------------------------------------------------
async function callWeatherApi(endpoint, queryParams) {
    if (!WEATHER_API_KEY) {
        throw new Error("WEATHER_API_KEY is not configured. Check .env file (local) or Vercel Environment Variables (online).");
    }

    // Luôn thêm Khóa API và Ngôn ngữ tiếng Việt (lang: 'vi')
    const params = new URLSearchParams({
        ...queryParams,
        key: WEATHER_API_KEY,
        lang: 'vi' 
    }).toString();

    const fullUrl = `${BASE_URL}/${endpoint}.json?${params}`;
    console.log(`Forwarding request to: ${BASE_URL}/${endpoint}.json`);

    try {
        const response = await axios.get(fullUrl);
        // Trả về toàn bộ dữ liệu (response.data) nguyên vẹn
        return {
            status: 200,
            data: response.data
        };
    } catch (error) {
        // Xử lý và chuyển tiếp lỗi từ API bên thứ 3
        const status = error.response ? error.response.status : 500;
        const data = error.response ? error.response.data : { code: 'API_ERROR', message: "Internal server error." };
        
        return {
            status: status,
            data: data
        };
    }
}

// ----------------------------------------------------------------------
// ENDPOINT 1: Xem thời tiết hiện tại (/api/current)
// ----------------------------------------------------------------------
app.get('/api/current', async (req, res) => {
    const { q } = req.query;

    if (!q) {
        return res.status(400).json({ 
            error: "Thiếu tham số 'q'. Vui lòng cung cấp vị trí." 
        });
    }

    const { status, data } = await callWeatherApi('current', { q, aqi: 'yes' });
    
    // Trả về kết quả nguyên vẹn (Không lọc dữ liệu)
    res.status(status).json(data);
});

// ----------------------------------------------------------------------
// ENDPOINT 2: Xem dự báo thời tiết (/api/forecast)
// ----------------------------------------------------------------------
app.get('/api/forecast', async (req, res) => {
    const { q, days } = req.query;

    if (!q) {
        return res.status(400).json({ 
            error: "Thiếu tham số 'q'. Vui lòng cung cấp vị trí." 
        });
    }

    const forecastDays = days && !isNaN(parseInt(days)) ? parseInt(days) : 5; 
    
    const { status, data } = await callWeatherApi('forecast', { q, days: forecastDays, aqi: 'yes', alerts: 'yes' });

    // Trả về kết quả nguyên vẹn (Không lọc dữ liệu)
    res.status(status).json(data);
});

// ----------------------------------------------------------------------
// ENDPOINT 3: Tìm kiếm thành phố (/api/search)
// ----------------------------------------------------------------------
app.get('/api/search', async (req, res) => {
    const { q } = req.query;

    if (!q) {
        return res.status(400).json({ 
            error: "Thiếu tham số 'q'. Vui lòng cung cấp từ khóa tìm kiếm." 
        });
    }

    const { status, data } = await callWeatherApi('search', { q });
    
    // Trả về kết quả nguyên vẹn (Không lọc dữ liệu)
    res.status(status).json(data);
});

// ----------------------------------------------------------------------
// ENDPOINT 4 & CẤU HÌNH LOCAL/VERCEL
// ----------------------------------------------------------------------
app.get('/', (req, res) => {
    res.status(200).json({
        message: "Weather Proxy API is running! Data filtering is INACTIVE.",
        note: "JSON is configured for 'Pretty Print' with 2 spaces.",
        status: "OK"
    });
});

module.exports = app; 

const PORT = process.env.PORT || 3000; 

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`🚀 Web API Trung Gian (PRETTY PRINT ACTIVE) ĐÃ SẴN SÀNG trên cổng ${PORT}`);
        console.log(`URL cục bộ: http://localhost:${PORT}`);
    });
}