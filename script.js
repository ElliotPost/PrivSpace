const API_KEY = '68838ceeee95b5f7a28ddd04dcad19cc';
const GRID = document.getElementById('grid');
const MODAL = document.getElementById('modal');
const SEARCH = document.getElementById('search');
const OUTPUT = document.getElementById('output');
const LOADING = document.getElementById('loading');
const SOURCE_LIST = document.getElementById('source-list');
const EPISODE_SELECTOR = document.getElementById('episode-selector');
const SEASON_TABS = document.getElementById('season-tabs');
const EPISODE_LIST = document.getElementById('episode-list');

let client = new WebTorrent();
let currentTorrent = null;
let currentShow = null;
let currentSeason = 1;

const CORS_PROXY = 'https://api.allorigins.win/raw?url=';

// Navbar scroll effect
window.addEventListener('scroll', () => {
    const navbar = document.querySelector('.navbar');
    if (window.scrollY > 50) {
        navbar.classList.add('scrolled');
    } else {
        navbar.classList.remove('scrolled');
    }
});

// 1. Search TMDB
async function searchTMDB(query, type = 'movie') {
    const url = type === 'movie' 
        ? `https://api.themoviedb.org/3/search/movie?api_key=${API_KEY}&query=${encodeURIComponent(query)}`
        : `https://api.themoviedb.org/3/search/tv?api_key=${API_KEY}&query=${encodeURIComponent(query)}`;
    
    try {
        const res = await fetch(url);
        const data = await res.json();
        renderGrid(data.results, type);
    } catch (e) {
        console.error('TMDB error:', e);
    }
}

// 2. Render Grid
function renderGrid(items, type) {
    GRID.innerHTML = '';
    items.forEach(item => {
        if (!item.poster_path) return;
        const title = type === 'movie' ? item.title : item.name;
        const year = (item.release_date || item.first_air_date || '').split('-')[0];
        
        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = `
            <img src="https://image.tmdb.org/t/p/w500${item.poster_path}">
            <h3>${title}</h3>
            <div class="year">${year}</div>
        `;
        card.onclick = () => openModal(item, type);
        GRID.appendChild(card);
    });
}

// 3. Fetch Movie Magnets (YTS)
async function getMovieMagnets(title, year) {
    try {
        const res = await fetch(`https://yts.mx/api/v2/list_movies.json?query_term=${encodeURIComponent(title)} ${year}`);
        const data = await res.json();
        if (data.status === 'ok' && data.data.movie_count > 0) {
            return data.data.movies[0].torrents.map(t => ({
                name: `${t.quality} ${t.type || ''}`.trim(),
                magnet: t.url,
                size: t.size,
                seeds: t.seeds
            }));
        }
    } catch (e) {
        console.error('YTS error:', e);
    }
    return [];
}

// 4. Fetch TV Episode Magnets (1337x scraper)
async function getEpisodeMagnets(showTitle, season, episode) {
    const query = `${showTitle} S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`;
    const searchUrl = `https://1337x.to/search/${encodeURIComponent(query)}/1/`;
    
    try {
        const proxyUrl = CORS_PROXY + encodeURIComponent(searchUrl);
        const res = await fetch(proxyUrl);
        const html = await res.text();
        
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const rows = doc.querySelectorAll('table tbody tr');
        
        const results = [];
        rows.forEach(row => {
            const nameCell = row.querySelector('td:nth-child(1) a');
            const seedsCell = row.querySelector('td:nth-child(2)');
            const sizeCell = row.querySelector('td:nth-child(3)');
            
            if (nameCell) {
                const name = nameCell.textContent.trim();
                const link = nameCell.getAttribute('href');
                const seeds = seedsCell ? parseInt(seedsCell.textContent) : 0;
                const size = sizeCell ? sizeCell.textContent.trim() : 'Unknown';
                
                results.push({ name, link, seeds, size });
            }
        });
        
        results.sort((a, b) => b.seeds - a.seeds);
        
        const magnets = [];
        for (let i = 0; i < Math.min(3, results.length); i++) {
            const magnet = await getMagnetFromLink(results[i].link);
            if (magnet) {
                magnets.push({
                    name: results[i].name,
                    magnet: magnet,
                    size: results[i].size,
                    seeds: results[i].seeds
                });
            }
        }
        
        return magnets;
    } catch (e) {
        console.error('1337x error:', e);
        return [];
    }
}

// 5. Extract magnet from 1337x
async function getMagnetFromLink(path) {
    try {
        const url = `https://1337x.to${path}`;
        const proxyUrl = CORS_PROXY + encodeURIComponent(url);
        const res = await fetch(proxyUrl);
        const html = await res.text();
        
        const match = html.match(/href="(magnet:\?[^"]+)"/);
        if (match) return match[1];
    } catch (e) {
        console.error('Magnet extraction error:', e);
    }
    return null;
}

// 6. Fetch TV Show Details
async function getShowDetails(tvId) {
    const res = await fetch(`https://api.themoviedb.org/3/tv/${tvId}?api_key=${API_KEY}`);
    return await res.json();
}

// 7. Render Episode Selector
async function renderEpisodeSelector(show) {
    const details = await getShowDetails(show.id);
    currentShow = show;
    
    SEASON_TABS.innerHTML = '';
    details.seasons.forEach(season => {
        if (season.season_number === 0) return;
        
        const tab = document.createElement('button');
        tab.className = 'season-tab' + (season.season_number === 1 ? ' active' : '');
        tab.textContent = `Season ${season.season_number}`;
        tab.onclick = () => selectSeason(season.season_number, details.seasons);
        SEASON_TABS.appendChild(tab);
    });
    
    selectSeason(1, details.seasons);
    EPISODE_SELECTOR.classList.remove('hidden');
}

// 8. Select Season
async function selectSeason(seasonNum, seasons) {
    currentSeason = seasonNum;
    
    document.querySelectorAll('.season-tab').forEach(tab => {
        tab.classList.remove('active');
        if (tab.textContent === `Season ${seasonNum}`) tab.classList.add('active');
    });
    
    const season = seasons.find(s => s.season_number === seasonNum);
    if (!season) return;
    
    const res = await fetch(`https://api.themoviedb.org/3/tv/${currentShow.id}/season/${seasonNum}?api_key=${API_KEY}`);
    const seasonData = await res.json();
    
    EPISODE_LIST.innerHTML = '';
    seasonData.episodes.forEach(ep => {
        const btn = document.createElement('button');
        btn.className = 'episode-btn';
        btn.textContent = `E${ep.episode_number}: ${ep.name}`;
        btn.onclick = () => selectEpisode(ep.episode_number);
        EPISODE_LIST.appendChild(btn);
    });
}

// 9. Select Episode
async function selectEpisode(episodeNum) {
    document.querySelectorAll('.episode-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.textContent.startsWith(`E${episodeNum}:`)) btn.classList.add('active');
    });
    
    SOURCE_LIST.innerHTML = '';
    OUTPUT.innerHTML = '';
    LOADING.classList.remove('hidden');
    
    const sources = await getEpisodeMagnets(currentShow.name, currentSeason, episodeNum);
    displaySources(sources);
}

// 10. Display Sources
function displaySources(sources) {
    SOURCE_LIST.innerHTML = '';
    
    if (sources.length > 0) {
        sources.forEach((src, index) => {
            const btn = document.createElement('button');
            btn.className = 'source-btn';
            btn.innerText = `${src.name} (${src.size}) - ${src.seeds} seeds`;
            btn.onclick = () => {
                document.querySelectorAll('.source-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                playStream(src.magnet);
            };
            SOURCE_LIST.appendChild(btn);
            
            if (index === 0) btn.click();
        });
    } else {
        LOADING.innerHTML = '<p>No streams found.</p>';
    }
}

// 11. Play Stream
function playStream(magnet) {
    LOADING.classList.remove('hidden');
    OUTPUT.innerHTML = '';
    
    if (currentTorrent) {
        currentTorrent.destroy();
    }

    client.add(magnet, function (torrent) {
        currentTorrent = torrent;
        const file = torrent.files.find(f => 
            f.name.endsWith('.mp4') || 
            f.name
