// ==========================================
// SERVER ABSENSI WFA
// ==========================================

// Atur timezone aplikasi
process.env.TZ = 'Asia/Jakarta';

require('dotenv').config();

const express = require('express');
const session = require('express-session');
const path = require('path');

const db = require('./config/db');

const User = require('./models/user');
const Attendance = require('./models/attendance');
const Leave = require('./models/leave');

// Import routes
const authRoutes = require('./routes/authRoutes');
const attendanceRoutes = require('./routes/attendanceRoutes');
const adminRoutes = require('./routes/adminRoutes');

const app = express();

// ==========================================
// RELASI DATABASE
// ==========================================

User.hasMany(Attendance, {
    foreignKey: 'user_id'
});

Attendance.belongsTo(User, {
    foreignKey: 'user_id'
});

User.hasMany(Leave, {
    foreignKey: 'user_id'
});

Leave.belongsTo(User, {
    foreignKey: 'user_id'
});

// ==========================================
// VIEW ENGINE
// ==========================================

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ==========================================
// MIDDLEWARE
// ==========================================

app.use(express.json());

app.use(express.urlencoded({
    extended: true
}));

app.use(express.static(
    path.join(__dirname, 'public')
));

// ==========================================
// SESSION
// ==========================================

const isProduction = process.env.NODE_ENV === 'production';

if (isProduction && !process.env.SESSION_SECRET) {
    console.error(
        'ERROR: SESSION_SECRET belum dikonfigurasi di Railway Variables.'
    );
    process.exit(1);
}

app.use(session({
    name: 'wfa.sid',
    secret: process.env.SESSION_SECRET || 'dev-only-session-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000
    }
}));

// ==========================================
// ROUTES
// ==========================================

app.use(authRoutes);
app.use(attendanceRoutes);
app.use('/admin', adminRoutes);

// ==========================================
// NAVIGASI UTAMA
// ==========================================

app.get('/', (req, res) => {
    res.redirect('/register');
});

app.get('/karyawan', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }

    return res.redirect(
        '/dashboard/' + req.session.user.id
    );
});

// ==========================================
// 404
// ==========================================

app.use((req, res) => {
    res.status(404).send('Halaman tidak ditemukan.');
});

// ==========================================
// START SERVER SETELAH DATABASE SIAP
// ==========================================

async function startServer() {
    try {
        console.log('Menghubungkan ke database...');

        await db.authenticate();

        console.log('Database connected successfully.');

        // Sinkronisasi model tanpa alter otomatis di production
        await db.sync();

        console.log('Database tables synchronized.');

        const PORT = process.env.PORT || 3000;

        app.listen(PORT, '0.0.0.0', () => {
            console.log(
                `Server WFA berjalan pada port ${PORT}`
            );
            console.log('Timezone: Asia/Jakarta');
        });

    } catch (error) {
        console.error(
            'Database/server initialization error:',
            error.message
        );

        process.exit(1);
    }
}

startServer();