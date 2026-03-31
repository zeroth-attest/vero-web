const express = require('express');
const path = require('path');

// Load .env in development
if (process.env.NODE_ENV !== 'production') {
  try { require('dotenv').config(); } catch (e) { /* dotenv optional in prod */ }
}

const simpleRoutes = require('./simple/routes');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());

// API routes for Simple Trust
app.use('/api/simple', simpleRoutes);

// Serve Simple Trust frontend
app.use('/simple', express.static(path.join(__dirname, 'simple', 'public')));

// SPA fallback for Simple Trust routes
app.get('/simple/*', (req, res) => {
  res.sendFile(path.join(__dirname, 'simple', 'public', 'index.html'));
});

// Serve existing static site (blink demo) from root
app.use(express.static(path.join(__dirname, 'public')));

// Fallback for root static site
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Vero web server running on port ${PORT}`);
});
