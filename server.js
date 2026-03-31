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

// API routes for Vero Voice (Simple Trust)
app.use('/api/simple', simpleRoutes);

// Serve Vero Voice frontend at /simple (also aliased as /voice)
app.use('/simple', express.static(path.join(__dirname, 'simple', 'public')));
app.use('/voice', express.static(path.join(__dirname, 'simple', 'public')));

// SPA fallback for Vero Voice routes
app.get('/simple/*', (req, res) => {
  res.sendFile(path.join(__dirname, 'simple', 'public', 'index.html'));
});
app.get('/voice/*', (req, res) => {
  res.sendFile(path.join(__dirname, 'simple', 'public', 'index.html'));
});

// Alias /video to /blink for Vero Video
app.get('/video', (req, res) => {
  res.redirect('/blink');
});

// The old configure page is preserved at /configure
app.get('/configure', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'configure.html'));
});

// Serve existing static site (landing + blink demo) from root
app.use(express.static(path.join(__dirname, 'public')));

// Fallback to landing page
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Vero web server running on port ${PORT}`);
});
