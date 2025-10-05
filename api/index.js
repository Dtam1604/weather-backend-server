// File: server.js (Mã nguồn Web API trung gian đầy đủ)
const express = require('express');
const axios = require('axios');
require('dotenv').config(); // Tải biến từ file .env

// Cấu hình API và Server
const app = express();
const PORT = process.env.PORT || 3000;
const WEATHER_API_KEY = process.env.WEATHER_API_KEY;
const BASE_URL = 'http://api.weatherapi.com/v1';

// Cấu hình CORS
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    next();
});

// Hàm tiện ích chung để gọi WeatherAPI.com
async function callWeatherApi(endpoint, queryParams) {
    if (!WEATHER_API_KEY) {
        throw { status: 500, message: "Lỗi cấu hình: Khóa API không tìm thấy trên máy chủ." };
    }

    const params = new URLSearchParams({
        ...queryParams,
        key: WEATHER_API_KEY,
        lang: 'vi' // Đặt ngôn ngữ tiếng Việt theo yêu cầu ứng dụng
    }).toString();

    const fullUrl = `${BASE_URL}${endpoint}?${params}`;
    
    try {
        const response = await axios.get(fullUrl);
        return response.data;
    } catch (error) {
        const status = error.response?.status || 500;
        const message = error.response?.data?.error?.message || "Lỗi không xác định khi gọi WeatherAPI.";
        throw { status, message };
    }
}

// ----------------------------------------------------
//                    ENDPOINTS CỐT LÕI
// ----------------------------------------------------

/**
 * Endpoint 1: Thời tiết Hiện tại (UC1)
 * Yêu cầu: GET /api/current?q=<LOCATION>
 */
app.get('/api/current', async (req, res) => {
    const q = req.query.q; 
    if (!q) return res.status(400).json({ error: "Tham số 'q' (vị trí) là bắt buộc." });

    try {
        const data = await callWeatherApi('/current.json', { q, aqi: 'yes' }); 
        
        // Lọc dữ liệu cần thiết cho màn hình chính (MainActivity)
        const filteredData = {
            location: {
                name: data.location.name,
                country: data.location.country,
                lat: data.location.lat,
                lon: data.location.lon,
            },
            current: {
                temp_c: data.current.temp_c,
                condition: data.current.condition.text, 
                icon_url: data.current.condition.icon, // Icon minh họa
                humidity: data.current.humidity,
                wind_kph: data.current.wind_kph,
            }
        };

        res.json(filteredData);
    } catch (err) {
        res.status(err.status || 500).json({ error: "Không thể tải dữ liệu thời tiết.", details: err.message });
    }
});

/**
 * Endpoint 2: Dự báo (UC2)
 * Yêu cầu: GET /api/forecast?q=<LOCATION>&days=<NUMBER>
 */
app.get('/api/forecast', async (req, res) => {
    const q = req.query.q;
    const days = req.query.days || 5; 
    
    if (!q) return res.status(400).json({ error: "Tham số 'q' (vị trí) là bắt buộc." });
    if (days < 1 || days > 14) return res.status(400).json({ error: "Tham số 'days' phải từ 1 đến 14." });

    try {
        // Trả về toàn bộ dữ liệu dự báo để Android (ForecastActivity) xử lý
        const data = await callWeatherApi('/forecast.json', { 
            q, 
            days, 
            aqi: 'yes', 
            alerts: 'yes' // Hỗ trợ UC7: Nhận thông báo thời tiết xấu
        }); 
        
        res.json(data); 
    } catch (err) {
        res.status(err.status || 500).json({ error: "Không thể tải dữ liệu dự báo.", details: err.message });
    }
});

/**
 * Endpoint 3: Tìm kiếm Thành phố (UC3)
 * Yêu cầu: GET /api/search?q=<SEARCH_QUERY>
 */
app.get('/api/search', async (req, res) => {
    const q = req.query.q;
    
    if (!q || q.length < 2) {
        return res.status(400).json({ error: "Tham số 'q' phải có ít nhất 2 ký tự để tìm kiếm thành phố." });
    }

    try {
        const data = await callWeatherApi('/search.json', { q }); 
        
        // Lọc kết quả tìm kiếm (cần thiết cho Bảng City trong RoomDatabase)
        const searchResults = data.map(item => ({
            id: item.id,
            name: item.name,
            region: item.region,
            country: item.country,
            lat: item.lat,
            lon: item.lon,
        }));
        
        res.json(searchResults); 
    } catch (err) {
        res.status(err.status || 500).json({ error: "Không thể tìm kiếm thành phố.", details: err.message });
    }
});

// Endpoint kiểm tra hoạt động của server
app.get('/', (req, res) => {
    res.send('Weather Proxy API is running!');
});
module.exports = app;
// Khởi động Server
// app.listen(PORT, () => {
//     console.log(`\n***************************************************`);
//     console.log(`🚀 Web API Trung Gian ĐÃ SẴN SÀNG trên cổng ${PORT}`);
//     console.log(`Kiểm tra Current: http://localhost:${PORT}/api/current?q=Hanoi`);
//     console.log(`***************************************************\n`);
// });