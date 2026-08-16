require('dotenv').config() // Load variabel lingkungan dari file .env
const express = require('express')
const session = require('express-session')
const path = require('path')
const db = require('./config/db')
const User = require('./models/user')
const Attendance = require('./models/attendance')
const Leave = require('./models/leave')

// IMPOR ROUTE
const authRoutes = require('./routes/authRoutes')
const attendanceRoutes = require('./routes/attendanceRoutes')
const adminRoutes = require('./routes/adminRoutes')

// ==========================================
// DEFINISI RELASI DATABASE
// ==========================================
User.hasMany(Attendance, { foreignKey: 'user_id' });
Attendance.belongsTo(User, { foreignKey: 'user_id' });
User.hasMany(Leave, { foreignKey: 'user_id' });
Leave.belongsTo(User, { foreignKey: 'user_id' });
// ==========================================

const app = express()

// 1. Pengaturan View Engine (EJS)
app.set('view engine', 'ejs')
app.set('views', path.join(__dirname, 'views'))

// 2. Middleware Parsing Data Form & JSON
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(express.static(path.join(__dirname, 'public')))

// 3. Mengaktifkan Fitur Session Otomatis
app.use(session({
    secret: process.env.SESSION_SECRET || 'rahasia_super_aman_absensi_wfa_2026',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 } // Session aktif selama 24 Jam
}));

// 4. Jalur Router (Harus diletakkan DI BAWAH middleware session)
app.use(authRoutes)
app.use(attendanceRoutes)
app.use('/admin', adminRoutes)

// ==========================================
// KONEKSI & SINKRONISASI DATABASE
// ==========================================
db.authenticate()
    .then(() => console.log('Database connected successfully.'))
    .catch(err => console.log('Database connection error:', err))

db.sync({ alter: true })
    .then(() => console.log('Database tables synchronized.'))
    .catch(err => console.log('Database sync error:', err))

// ==========================================
// RUTE NAVIGASI UTAMA
// ==========================================
app.get('/', (req, res) => {
    res.redirect('/register')
})

app.get('/karyawan', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }
    res.redirect('/dashboard/' + req.session.user.id);
});

// Server Listener (Port dinamis untuk Cloud Hosting)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running secara otomatis di port ${PORT}`)
})