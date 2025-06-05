export default {
	async fetch(request, env) {
		console.log(`[SVG] === WORKER STARTED ===`);
		console.log(`[SVG] Request: ${request.method} ${request.url}`);

		let headline;

		// Check if this is a service binding call or HTTP request
		if (request.headers.get('x-service-binding') === 'true') {
			console.log(`[SVG] Service binding call detected`);
			try {
				const body = await request.json();
				headline = body.headline;
				console.log(`[SVG] Headline from service binding: ${headline}`);
			} catch (error) {
				console.error(`[SVG] Failed to parse service binding request:`, error);
				return new Response('Invalid service binding request', {
					status: 400,
					headers: {
						'x-error-type': 'service-binding-parse-error',
					},
				});
			}
		} else {
			console.log(`[SVG] HTTP request detected`);
			const { searchParams } = new URL(request.url);
			headline = searchParams.get('headline');
		}

		if (!headline) {
			console.error(`[SVG] No headline provided`);
			return new Response('Headline is required', {
				status: 400,
				headers: {
					'x-error-type': 'missing-headline',
				},
			});
		}

		// Check cache first
		const cacheKey = `svg_${headline}`;
		let cachedHtml = await env.SVG_CACHE.get(cacheKey);

		if (cachedHtml) {
			console.log(`[SVG] Cache hit for headline`);
			return new Response(cachedHtml, {
				headers: {
					'Content-Type': 'text/html',
					'Cache-Control': 'public, max-age=86400',
					'Access-Control-Allow-Origin': '*',
					'x-cache-status': 'hit',
				},
			});
		}

		console.log(`[SVG] Cache miss - generating new SVG`);
		// Generate new SVG HTML
		const html = generateSVGHTML(headline);

		// Cache for 30 days
		try {
			await env.SVG_CACHE.put(cacheKey, html, {
				expirationTtl: 60 * 60 * 24 * 30,
			});
			console.log(`[SVG] Successfully cached new SVG`);
		} catch (error) {
			console.error(`[SVG] Failed to cache SVG:`, error);
			// Continue anyway - we can still return the generated HTML
		}

		return new Response(html, {
			headers: {
				'Content-Type': 'text/html',
				'Cache-Control': 'public, max-age=86400',
				'Access-Control-Allow-Origin': '*',
				'x-cache-status': 'miss',
			},
		});
	},
};

function generateSVGHTML(headline) {
	// Break text into lines with a more aggressive character limit
	const words = headline.split(' ');
	const lines = [];
	let currentLine = [];
	let currentLength = 0;
	const MAX_LINE_LENGTH = 20; // Reduced from 30 to 20 characters

	// Break into lines with shorter length
	for (const word of words) {
		// If adding this word would exceed our limit, or if it's a very long word
		if (currentLength + word.length > MAX_LINE_LENGTH || word.length > MAX_LINE_LENGTH) {
			// If it's a current line, push it
			if (currentLine.length > 0) {
				lines.push(currentLine.join(' '));
				currentLine = [];
				currentLength = 0;
			}

			// If the word itself is too long, break it
			if (word.length > MAX_LINE_LENGTH) {
				const chunks = word.match(new RegExp(`.{1,${MAX_LINE_LENGTH}}`, 'g')) || [];
				lines.push(...chunks);
			} else {
				currentLine = [word];
				currentLength = word.length;
			}
		} else {
			currentLine.push(word);
			currentLength += word.length + 1;
		}
	}

	// Don't forget the last line
	if (currentLine.length > 0) {
		lines.push(currentLine.join(' '));
	}

	// More conservative font size calculation
	const maxLineLength = Math.max(...lines.map((line) => line.length));
	const BASE_FONT_SIZE = 60; // Reduced from 80
	const fontSize = Math.min(
		BASE_FONT_SIZE,
		(800 / maxLineLength) * 1.5, // More conservative width calculation
		900 / (lines.length * 1.5) // More conservative height calculation
	);

	const lineHeight = fontSize * 1.3; // Increased from 1.2 for better spacing
	const totalHeight = lines.length * lineHeight;
	const startY = (1080 - totalHeight) / 2 + lineHeight / 2;

	return `<!DOCTYPE html>
<html>
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=1080, height=1080, initial-scale=1.0">
	<style>
		body { 
			margin: 0; 
			padding: 0; 
			width: 1080px; 
			height: 1080px; 
			overflow: hidden;
		}
		svg { 
			display: block; 
			width: 1080px; 
			height: 1080px;
			position: fixed;
			top: 0;
			left: 0;
		}
	</style>
</head>
<body>
	<svg viewBox="0 0 1080 1080" width="1080" height="1080" xmlns="http://www.w3.org/2000/svg">
		<!-- Background Image -->
		<image href="https://news.fasttakeoff.org/images/brain.png" width="1080" height="1080"/>
		
		<!-- Semi-transparent overlay -->
		<rect x="0" y="0" width="1080" height="1080" fill="rgba(0,0,0,0.4)"/>
		
		<!-- Text background for better readability -->
		<rect 
			x="90" 
			y="${startY - fontSize}" 
			width="900" 
			height="${totalHeight + fontSize}" 
			fill="rgba(0,0,0,0.3)" 
			rx="10"
		/>
		
		<!-- Multi-line text -->
		${lines
			.map(
				(line, i) => `
			<text 
				x="540" 
				y="${startY + i * lineHeight}"
				font-family="Arial, sans-serif" 
				font-size="${fontSize}" 
				font-weight="bold"
				fill="white" 
				text-anchor="middle" 
				dominant-baseline="middle"
				stroke="black" 
				stroke-width="2">
				${escapeHtml(line)}
			</text>
		`
			)
			.join('')}
	</svg>
</body>
</html>`;
}

function escapeHtml(text) {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
