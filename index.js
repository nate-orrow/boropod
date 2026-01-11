//region Configuration
const CONFIG = {
    acastFeed: 'https://feeds.acast.com/public/shows/6422cc6fbebb2c001130f8a2',
    blueskyHandle: 'boropod.bsky.social',
    youtubeChannelId: 'UCQ21dvAKJn6NrIXJVsqDftA',
    substackUrl: '',
    refreshInterval: 10000
};

let currentAudio = null;
let currentFilter = null;
let knownItemIds = new Set();
let refreshTimer = null;
//endregion

//region Fetch Functions
async function fetchAllMedia() {
    const allMedia = [];

    try {
        const podcasts = await fetchAcast();
        allMedia.push(...podcasts);

        const bluesky = await fetchBluesky();
        allMedia.push(...bluesky);

        if (CONFIG.youtubeChannelId && CONFIG.youtubeChannelId.length > 0 && CONFIG.youtubeChannelId !== 'YOUR_CHANNEL_ID_HERE') {
            const youtube = await fetchYouTube();
            allMedia.push(...youtube);
        }

        allMedia.sort((a, b) => new Date(b.date) - new Date(a.date));

        renderGrid(allMedia);
    } catch (error) {
        console.error('Error fetching media:', error);
        document.getElementById('loading').textContent = 'Error loading content. Please refresh.';
    }
}

async function fetchAcast() {
    try {
        const cacheBuster = '?_=' + Date.now();
        const proxyUrl = 'https://corsproxy.io/?' + encodeURIComponent(CONFIG.acastFeed + cacheBuster);
        const response = await fetch(proxyUrl);
        const text = await response.text();
        const parser = new DOMParser();
        const xml = parser.parseFromString(text, 'text/xml');
        const items = xml.querySelectorAll('item');

        const channelImage = xml.querySelector('channel > image > url')?.textContent || '';

        return Array.from(items).slice(0, 12).map((item) => {
            const enclosure = item.querySelector('enclosure');
            const description = item.querySelector('description')?.textContent || '';
            const cleanDesc = description.replace(/<[^>]*>/g, '').substring(0, 200);
            const guid = item.querySelector('guid')?.textContent || Math.random().toString();

            return {
                id: 'podcast-' + guid,
                type: 'podcast',
                title: item.querySelector('title')?.textContent || '',
                description: cleanDesc,
                date: item.querySelector('pubDate')?.textContent || '',
                audioUrl: enclosure?.getAttribute('url') || '',
                image: item.querySelector('image')?.getAttribute('href') || channelImage,
                duration: item.querySelector('duration')?.textContent || ''
            };
        });
    } catch (error) {
        console.error('Acast fetch error:', error);
        return [];
    }
}

async function fetchBluesky() {
    try {
        const blueskyUrl = 'https://bsky.app/profile/' + CONFIG.blueskyHandle + '/rss';
        const cacheBuster = '?_=' + Date.now();
        const proxyUrl = 'https://corsproxy.io/?' + encodeURIComponent(blueskyUrl + cacheBuster);
        const response = await fetch(proxyUrl);
        const text = await response.text();
        const parser = new DOMParser();
        const xml = parser.parseFromString(text, 'text/xml');
        const items = xml.querySelectorAll('item');

        return Array.from(items).slice(0, 10).map((item) => {
            const description = item.querySelector('description')?.textContent || '';
            const link = item.querySelector('link')?.textContent || '';

            const postId = link.split('/').pop() || 'unknown';

            let imageUrl = null;

            const mediaContent = item.querySelector('media\\:content, content');
            if (mediaContent) {
                imageUrl = mediaContent.getAttribute('url');
            }

            if (!imageUrl) {
                const enclosure = item.querySelector('enclosure');
                if (enclosure && enclosure.getAttribute('type')?.startsWith('image/')) {
                    imageUrl = enclosure.getAttribute('url');
                }
            }

            if (!imageUrl) {
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = description;
                const img = tempDiv.querySelector('img');
                if (img) {
                    imageUrl = img.src;
                }
            }

            if (!imageUrl) {
                const imageUrlMatch = description.match(/(https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp))/i);
                if (imageUrlMatch) {
                    imageUrl = imageUrlMatch[1];
                }
            }

            let cleanDesc = description.replace(/<[^>]*>/g, '');
            cleanDesc = cleanDesc.replace(/https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp)/gi, '').trim();
            cleanDesc = cleanDesc.replace(/hh=\d+&ww=\d+/g, '').trim();

            return {
                id: 'bluesky-' + postId,
                type: 'social',
                title: 'Bluesky Post',
                description: cleanDesc.substring(0, 400),
                date: item.querySelector('pubDate')?.textContent || '',
                link: link,
                platform: 'Bluesky',
                image: imageUrl
            };
        });
    } catch (error) {
        console.error('Bluesky fetch error:', error);
        return [];
    }
}

async function fetchYouTube() {
    try {
        const youtubeUrl = 'https://www.youtube.com/feeds/videos.xml?channel_id=' + CONFIG.youtubeChannelId;
        const cacheBuster = '&_=' + Date.now();
        const proxyUrl = 'https://corsproxy.io/?' + encodeURIComponent(youtubeUrl + cacheBuster);
        const response = await fetch(proxyUrl);
        const text = await response.text();
        const parser = new DOMParser();
        const xml = parser.parseFromString(text, 'text/xml');
        const entries = xml.querySelectorAll('entry');

        return Array.from(entries).slice(0, 8).map((entry) => {
            const videoId = entry.querySelector('videoId')?.textContent || entry.querySelector('yt\\:videoId')?.textContent || '';
            const title = entry.querySelector('title')?.textContent || '';
            const published = entry.querySelector('published')?.textContent || '';

            return {
                id: 'youtube-' + videoId,
                type: 'youtube',
                title: title,
                description: '',
                date: published,
                videoId: videoId,
                thumbnail: 'https://i.ytimg.com/vi/' + videoId + '/hqdefault.jpg'
            };
        });
    } catch (error) {
        console.error('YouTube fetch error:', error);
        return [];
    }
}
//endregion

//region Auto Refresh
async function checkForNewContent() {
    try {
        const allMedia = [];

        const podcasts = await fetchAcast();
        allMedia.push(...podcasts);

        const bluesky = await fetchBluesky();
        allMedia.push(...bluesky);

        if (CONFIG.youtubeChannelId && CONFIG.youtubeChannelId.length > 0 && CONFIG.youtubeChannelId !== 'YOUR_CHANNEL_ID_HERE') {
            const youtube = await fetchYouTube();
            allMedia.push(...youtube);
        }

        const newItems = allMedia.filter(item => !knownItemIds.has(item.id));

        if (newItems.length > 0) {
            newItems.sort((a, b) => new Date(b.date) - new Date(a.date));
            prependItemsToGrid(newItems);
            newItems.forEach(item => knownItemIds.add(item.id));
        }
    } catch (error) {
        console.error('Error checking for new content:', error);
    }
}

function prependItemsToGrid(items) {
    const grid = document.getElementById('grid');

    items.forEach(item => {
        const card = createCard(item);
        card.style.opacity = '0';
        card.style.transform = 'translateY(-20px)';

        grid.insertBefore(card, grid.firstChild);

        setTimeout(() => {
            card.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
            card.style.opacity = '1';
            card.style.transform = 'translateY(0)';
        }, 10);
    });

    setupFilters();

    setTimeout(() => {
        reloadMasonry();
        layoutAfterImagesLoad();
    }, 100);
}

function startAutoRefresh() {
    if (refreshTimer) {
        clearInterval(refreshTimer);
    }

    refreshTimer = setInterval(checkForNewContent, CONFIG.refreshInterval);
}

function stopAutoRefresh() {
    if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = null;
    }
}
//endregion

//region Render Functions
function renderGrid(mediaItems) {
    const grid = document.getElementById('grid');
    const loading = document.getElementById('loading');

    loading.style.display = 'none';
    grid.innerHTML = '';

    mediaItems.forEach(item => {
        const card = createCard(item);
        grid.appendChild(card);
        knownItemIds.add(item.id);
    });

    setupFilters();

    const filterChips = document.querySelectorAll('.filter-chip');
    filterChips.forEach(chip => chip.classList.add('active'));
    currentFilter = ['podcast', 'youtube', 'social'];

    initMasonry();
    layoutAfterImagesLoad();

    startAutoRefresh();
}

function createCard(item) {
    const card = document.createElement('div');
    card.className = 'card ' + item.type;

    if (item.type === 'podcast') {
        card.innerHTML =
            '<span class="card-type">Podcast</span>' +
            (item.image ? '<img src="' + item.image + '" alt="' + item.title + '" class="card-image">' : '') +
            '<div class="card-overlay">' +
            '<div class="overlay-content">' +
            '<h3 class="card-title">' + item.title + '</h3>' +
            '<p class="card-description">' + item.description + '</p>' +
            '<div class="card-meta">' +
            '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>' +
            '<span>' + formatDate(item.date) + '</span>' +
            (item.duration ?
                '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>' +
                '<span>' + item.duration + '</span>'
                : '') +
            '</div>' +
            '</div>' +
            '<div class="audio-player">' +
            '<button class="play-button" onclick="toggleAudio(\'' + item.id + '\', \'' + item.audioUrl + '\')">' +
            '<svg id="icon-' + item.id + '" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>' +
            '<span id="text-' + item.id + '">Play Episode</span>' +
            '</button>' +
            '<audio id="audio-' + item.id + '" src="' + item.audioUrl + '"></audio>' +
            '</div>' +
            '</div>';
    } else if (item.type === 'youtube') {
        card.innerHTML =
            '<span class="card-type">YouTube</span>' +
            '<img src="' + item.thumbnail + '" alt="' + item.title + '" class="card-image" onerror="this.src=\'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22400%22 height=%22300%22%3E%3Crect fill=%22%231a1a1a%22 width=%22400%22 height=%22300%22/%3E%3C/svg%3E\'>">' +
            '<div class="card-overlay">' +
            '<div class="overlay-content">' +
            '<h3 class="card-title">' + item.title + '</h3>' +
            '<div class="card-meta">' +
            '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>' +
            '<span>' + formatDate(item.date) + '</span>' +
            '</div>' +
            '</div>' +
            '<button class="play-button" onclick="playYouTubeVideo(\'' + item.videoId + '\', this)">' +
            '<svg fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>' +
            '<span>Play Video</span>' +
            '</button>' +
            '</div>';
    } else if (item.type === 'social') {
        const linkedText = linkifyText(item.description);

        card.innerHTML =
            '<div class="card-content">' +
            '<span class="card-type">' + item.platform + '</span>' +
            (item.image ? '<img src="' + item.image + '" alt="Post image" class="social-image">' : '') +
            '<p class="social-text">' + linkedText + '</p>' +
            '<div class="card-meta">' +
            '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>' +
            '<span>' + formatDate(item.date) + '</span>' +
            '</div>' +
            '<a href="' + item.link + '" target="_blank" class="social-link">View on ' + item.platform + ' →</a>' +
            '</div>';
    }

    return card;
}
//endregion

//region Audio Player
function toggleAudio(id, url) {
    const audio = document.getElementById('audio-' + id);
    const icon = document.getElementById('icon-' + id);
    const text = document.getElementById('text-' + id);

    if (currentAudio && currentAudio !== audio) {
        currentAudio.pause();
        const currentId = currentAudio.id.replace('audio-', '');
        document.getElementById('icon-' + currentId).innerHTML = '<path d="M8 5v14l11-7z"/>';
        document.getElementById('text-' + currentId).textContent = 'Play Episode';
    }

    if (audio.paused) {
        audio.play();
        icon.innerHTML = '<path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>';
        text.textContent = 'Pause';
        currentAudio = audio;
        playerAudio = audio;

        // Find episode data
        const card = document.getElementById('audio-' + id).closest('.card');
        const episodeData = {
            title: card.querySelector('.card-title')?.textContent || 'Episode',
            image: card.querySelector('.card-image')?.src || ''
        };

        showMediaPlayer(episodeData);
    } else {
        audio.pause();
        icon.innerHTML = '<path d="M8 5v14l11-7z"/>';
        text.textContent = 'Play Episode';
        currentAudio = null;
    }

    audio.onended = function() {
        icon.innerHTML = '<path d="M8 5v14l11-7z"/>';
        text.textContent = 'Play Episode';
        currentAudio = null;
        hideMediaPlayer();
    };
}
//endregion

//region Media Player
let playerAudio = null;
let playerUpdateInterval = null;

function showMediaPlayer(episodeData) {
    const player = document.getElementById('media-player');
    const artwork = document.getElementById('player-artwork-img');
    const title = document.getElementById('player-title');

    artwork.src = episodeData.image;
    title.textContent = episodeData.title;

    player.classList.remove('hidden');
    player.classList.remove('minimized'); // Always show expanded when new episode starts

    // Update player state
    updatePlayerUI();

    // Start progress updates
    if (playerUpdateInterval) {
        clearInterval(playerUpdateInterval);
    }
    playerUpdateInterval = setInterval(updateProgress, 100);
}

function hideMediaPlayer() {
    const player = document.getElementById('media-player');
    player.classList.add('hidden');

    if (playerUpdateInterval) {
        clearInterval(playerUpdateInterval);
    }
}

function togglePlayer() {
    // Only allow minimize on tablet and desktop
    if (window.innerWidth > 640) {
        const player = document.getElementById('media-player');
        player.classList.toggle('minimized');
    }
}

function togglePlayerPlayback() {
    if (playerAudio) {
        if (playerAudio.paused) {
            playerAudio.play();
        } else {
            playerAudio.pause();
        }
        updatePlayerUI();
    }
}

function skipForward() {
    if (playerAudio) {
        playerAudio.currentTime = Math.min(playerAudio.currentTime + 15, playerAudio.duration);
    }
}

function skipBackward() {
    if (playerAudio) {
        playerAudio.currentTime = Math.max(playerAudio.currentTime - 15, 0);
    }
}

function updatePlayerUI() {
    if (!playerAudio) return;

    const playIcon = document.getElementById('player-play-icon');

    if (playerAudio.paused) {
        playIcon.setAttribute('d', 'M8 5v14l11-7z');
    } else {
        playIcon.setAttribute('d', 'M6 4h4v16H6V4zm8 0h4v16h-4V4z');
    }
}

function updateProgress() {
    if (!playerAudio) return;

    const currentTime = document.getElementById('player-current-time');
    const duration = document.getElementById('player-duration');
    const slider = document.getElementById('player-progress-slider');

    currentTime.textContent = formatTime(playerAudio.currentTime);
    duration.textContent = formatTime(playerAudio.duration || 0);

    if (playerAudio.duration) {
        slider.value = (playerAudio.currentTime / playerAudio.duration) * 100;
    }
}

function formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';

    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return mins + ':' + (secs < 10 ? '0' : '') + secs;
}

// Slider interaction
document.addEventListener('DOMContentLoaded', () => {
    const slider = document.getElementById('player-progress-slider');

    slider.addEventListener('input', (e) => {
        if (playerAudio && playerAudio.duration) {
            const seekTime = (e.target.value / 100) * playerAudio.duration;
            playerAudio.currentTime = seekTime;
        }
    });
});
//endregion

//region YouTube Video Player
function playYouTubeVideo(videoId, button) {
    const card = button.closest('.card');
    const overlay = card.querySelector('.card-overlay');

    const iframe = document.createElement('iframe');
    iframe.className = 'youtube-iframe';
    iframe.src = 'https://www.youtube.com/embed/' + videoId + '?autoplay=1';
    iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
    iframe.allowFullscreen = true;

    overlay.innerHTML = '';
    overlay.appendChild(iframe);
    overlay.style.opacity = '1';

    if (window.innerWidth <= 1024) {
        iframe.addEventListener('load', function() {
            if (iframe.requestFullscreen) {
                iframe.requestFullscreen();
            } else if (iframe.webkitRequestFullscreen) {
                iframe.webkitRequestFullscreen();
            } else if (iframe.mozRequestFullScreen) {
                iframe.mozRequestFullScreen();
            } else if (iframe.msRequestFullscreen) {
                iframe.msRequestFullscreen();
            }
        });
    }
}
//endregion

//region Filter Functions
function setupFilters() {
    const filterChips = document.querySelectorAll('.filter-chip');

    filterChips.forEach(chip => {
        chip.addEventListener('mouseenter', function() {
            const filterType = this.getAttribute('data-filter');
            if (currentFilter === null || currentFilter.length === 0) {
                applyDimEffect(filterType);
            }
        });

        chip.addEventListener('mouseleave', function() {
            if (currentFilter === null || currentFilter.length === 0) {
                clearDimEffect();
            }
        });

        chip.addEventListener('click', function(e) {
            e.stopPropagation();
            const filterType = this.getAttribute('data-filter');

            this.classList.toggle('active');

            const activeFilters = Array.from(document.querySelectorAll('.filter-chip.active'))
                .map(chip => chip.getAttribute('data-filter'));

            if (activeFilters.length === 0) {
                const filterChips = document.querySelectorAll('.filter-chip');
                filterChips.forEach(c => c.classList.add('active'));
                clearFilter();
            } else {
                applyMultiFilter(activeFilters);
            }
        });
    });

    document.body.addEventListener('click', handleBodyClick);
}

function handleBodyClick(e) {
    if (currentFilter === null || currentFilter.length === 0) return;

    if (e.target.closest('.card')) {
        return;
    }

    clearFilter();
}

function applyDimEffect(filterType) {
    const cards = document.querySelectorAll('.card');
    cards.forEach(card => {
        if (!card.classList.contains(filterType)) {
            card.classList.add('dimmed');
        }
    });
}

function clearDimEffect() {
    const cards = document.querySelectorAll('.card');
    cards.forEach(card => card.classList.remove('dimmed'));
}

function applyMultiFilter(filterTypes) {
    currentFilter = filterTypes;

    const cards = document.querySelectorAll('.card');
    cards.forEach(card => {
        card.classList.remove('dimmed');

        const shouldShow = filterTypes.some(type => card.classList.contains(type));

        if (!shouldShow) {
            card.classList.add('hidden');
        } else {
            card.classList.remove('hidden');
        }
    });

    if (masonryInstance) {
        masonryInstance.destroy();
    }

    const grid = document.getElementById('grid');
    masonryInstance = new Masonry(grid, {
        itemSelector: '.card:not(.hidden)',
        columnWidth: '.card:not(.hidden)',
        gutter: 16,
        percentPosition: true,
        transitionDuration: 0
    });
}

function clearFilter() {
    currentFilter = ['podcast', 'youtube', 'social'];

    const filterChips = document.querySelectorAll('.filter-chip');
    filterChips.forEach(c => c.classList.add('active'));

    const cards = document.querySelectorAll('.card');
    cards.forEach(card => {
        card.classList.remove('dimmed', 'hidden');
    });

    if (masonryInstance) {
        masonryInstance.destroy();
    }

    const grid = document.getElementById('grid');
    masonryInstance = new Masonry(grid, {
        itemSelector: '.card',
        columnWidth: '.card',
        gutter: 16,
        percentPosition: true,
        transitionDuration: 0
    });
}
//endregion

//region Masonry Layout
let masonryInstance = null;

function initMasonry() {
    const grid = document.getElementById('grid');

    if (masonryInstance) {
        masonryInstance.destroy();
    }

    // Calculate column width based on viewport
    let columns = 6;
    let gap = 16;

    if (window.innerWidth <= 640) {
        columns = 1;
        gap = 8;
    } else if (window.innerWidth <= 1024) {
        columns = 3;
        gap = 12;
    } else if (window.innerWidth <= 1440) {
        columns = 4;
        gap = 16;
    }

    const gridWidth = grid.offsetWidth;
    const columnWidth = (gridWidth - (gap * (columns - 1))) / columns;

    // Set card widths directly
    const cards = grid.querySelectorAll('.card');
    cards.forEach(card => {
        card.style.width = columnWidth + 'px';
    });

    masonryInstance = new Masonry(grid, {
        itemSelector: '.card',
        columnWidth: columnWidth,
        gutter: gap,
        fitWidth: false,
        horizontalOrder: true
    });
}

function layoutMasonry() {
    if (masonryInstance) {
        masonryInstance.layout();
    }
}

function reloadMasonry() {
    if (masonryInstance) {
        masonryInstance.reloadItems();
        masonryInstance.layout();
    }
}

function layoutAfterImagesLoad() {
    const grid = document.getElementById('grid');
    const images = grid.querySelectorAll('img');

    setTimeout(() => {
        if (masonryInstance) {
            masonryInstance.layout();
        }
    }, 100);

    let loadedImages = 0;
    const totalImages = images.length;

    if (totalImages === 0) {
        return;
    }

    images.forEach(img => {
        if (img.complete) {
            loadedImages++;
            if (loadedImages === totalImages) {
                setTimeout(() => {
                    if (masonryInstance) masonryInstance.layout();
                }, 100);
            }
        } else {
            img.addEventListener('load', () => {
                loadedImages++;
                if (loadedImages === totalImages) {
                    setTimeout(() => {
                        if (masonryInstance) masonryInstance.layout();
                    }, 100);
                }
            });

            img.addEventListener('error', () => {
                loadedImages++;
                if (loadedImages === totalImages) {
                    setTimeout(() => {
                        if (masonryInstance) masonryInstance.layout();
                    }, 100);
                }
            });
        }
    });
}

let resizeTimeout;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        if (masonryInstance) {
            initMasonry(); // Reinitialize instead of just layout
        }
    }, 100);
});
//endregion

//region Utility Functions
function linkifyText(text) {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return text.replace(urlRegex, function(url) {
        return '<a href="' + url + '" target="_blank" class="inline-link">' + url + '</a>';
    });
}

function formatDate(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diffTime = Math.abs(now - date);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return diffDays + ' days ago';
    if (diffDays < 30) return Math.floor(diffDays / 7) + ' weeks ago';

    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
//endregion

//region Initialize
fetchAllMedia();
//endregion