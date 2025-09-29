// Group Contact Scraper - OCR-based phone number extraction from group member screenshots
class GroupContactScraper {
    constructor() {
        this.selectedFiles = [];
        this.isProcessing = false;
        this.extractedContacts = [];
        this.worker = null; // Persistent Tesseract worker
        this.workerInitialized = false;
        // Don't initialize event listeners in constructor - will be called by dashboard
    }

    initialize() {
        this.initializeEventListeners();
        this.loadTesseract();
        this.addDebugButton();
    }

    addDebugButton() {
        // Add a debug button to test image splitting
        const debugButton = document.createElement('button');
        debugButton.textContent = 'Test Image Splitting';
        debugButton.className = 'btn btn-secondary';
        debugButton.style.marginLeft = '10px';
        debugButton.onclick = () => this.testImageSplitting();
        
        const startButton = document.getElementById('start-group-scraping');
        if (startButton && startButton.parentNode) {
            startButton.parentNode.appendChild(debugButton);
        }
    }

    preprocessImageForOCR(canvas, ctx) {
        console.log('Starting simple image preprocessing...');
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        const width = canvas.width;
        const height = canvas.height;
        
        // Step 1: Convert to grayscale using luminance formula
        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
            data[i] = gray;     // R
            data[i + 1] = gray; // G
            data[i + 2] = gray; // B
        }

        // Detect dark-mode background by sampling a border band and invert if needed
        let sampleSum = 0;
        let sampleCount = 0;
        const band = Math.max(1, Math.floor(Math.min(width, height) * 0.02)); // 2% border
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const onBorder = (x < band) || (y < band) || (x >= width - band) || (y >= height - band);
                if (!onBorder) continue;
                const idx = (y * width + x) * 4;
                sampleSum += data[idx];
                sampleCount++;
            }
        }
        const avgBorderLuma = sampleCount > 0 ? (sampleSum / sampleCount) : 255;
        const isDarkBackground = avgBorderLuma < 110; // heuristic threshold

        if (isDarkBackground) {
            for (let i = 0; i < data.length; i += 4) {
                const inv = 255 - data[i];
                data[i] = inv;
                data[i + 1] = inv;
                data[i + 2] = inv;
            }
            console.log('Applied auto inversion for dark-mode screenshot');
        }
        
        // Step 2: Simple contrast enhancement
        this.enhanceContrastSimple(data);
        
        // Step 3: Thresholding
        if (this.isNarrowPortrait) {
            this.applyAdaptiveThreshold(data, width, height);
        } else {
            this.applyBasicThreshold(data);
        }
        
        ctx.putImageData(imageData, 0, 0);
        console.log(this.isNarrowPortrait
            ? 'Applied advanced preprocessing: grayscale + contrast + adaptive threshold'
            : 'Applied simple preprocessing: grayscale + contrast + threshold');
    }

    // Decide zoom, PSM mode, and tiling based on image dimensions
    determineSectioningStrategy(imgWidth, imgHeight) {
        const aspectRatio = imgHeight / Math.max(1, imgWidth);
        const isVeryTall = aspectRatio >= 3; // tall scrolling screenshot
        const isTall = aspectRatio >= 1.6;
        const isNarrowPortrait = imgWidth <= 600; // common 540px captures

        // Zoom: ensure minimum working width for OCR stability and right-edge clarity
        // For 540px, push width higher to reduce character fusion and improve kerning
        const minWorkingWidth = isNarrowPortrait ? 960 : 720;
        const baseZoom = 2;
        const zoomFactor = Math.max(baseZoom, Math.ceil(minWorkingWidth / Math.max(1, imgWidth)));

        // After zoom, compute canvas dimensions
        const canvasWidth = imgWidth * zoomFactor;
        const canvasHeight = imgHeight * zoomFactor;

        // Tiling strategy
        let psmMode = '6'; // block of text (multi-line)
        let tileHeight;
        let overlap;

        if (isNarrowPortrait) {
            // On 540px sources: slightly taller tiles and moderate overlap to reduce duplicates
            tileHeight = Math.max(900, Math.min(1400, 1100));
            overlap = 130;
        } else if (isVeryTall) {
            overlap = 140;
            const targetTiles = Math.max(20, Math.min(40, Math.round((canvasHeight) / 900)));
            const desired = Math.floor(canvasHeight / targetTiles);
            tileHeight = Math.max(800, Math.min(1600, desired));
        } else if (isTall) {
            overlap = 120;
            const targetTiles = 24;
            const desired = Math.floor(canvasHeight / targetTiles);
            tileHeight = Math.max(800, Math.min(1600, desired));
        } else {
            tileHeight = canvasHeight;
            overlap = 0;
        }

        // For moderately short tiles in not-extremely-tall images, PSM 7 may help
        if (tileHeight <= 900 && aspectRatio < 2.5) {
            psmMode = '7'; // single text line
        }

        return { zoomFactor, psmMode, tileHeight, overlap };
    }

    // Split a canvas into vertical tiles with optional overlap
    splitCanvasIntoVerticalTiles(sourceCanvas, options = {}) {
        const { tileHeight = 800, overlap = 80 } = options;
        const tiles = [];
        const width = sourceCanvas.width;
        const height = sourceCanvas.height;

        if (tileHeight <= 0) {
            return [sourceCanvas];
        }

        let y = 0;
        const stride = Math.max(1, tileHeight - Math.min(overlap, tileHeight - 1));
        while (y < height) {
            const tileCanvas = document.createElement('canvas');
            const tileCtx = tileCanvas.getContext('2d', { willReadFrequently: true });

            const h = Math.min(tileHeight, height - y);
            // Add small vertical padding to capture full lines at boundaries
            const pad = Math.min(40, Math.floor(overlap / 2));
            const srcY = Math.max(0, y - pad);
            const srcH = Math.min(height - srcY, h + pad * 2);
            tileCanvas.width = width;
            tileCanvas.height = srcH;

            tileCtx.drawImage(sourceCanvas, 0, srcY, width, srcH, 0, 0, width, srcH);
            // Skip tiles that are too small for OCR
            if (tileCanvas.width >= 3 && tileCanvas.height >= 3) {
                tiles.push({ canvas: tileCanvas, sectionTop: y, sectionHeight: h });
            }

            if (y + h >= height) break;
            y += stride;
        }

        return tiles;
    }

    enhanceContrastSimple(data) {
        // Simple contrast enhancement - find min/max and stretch
        let min = 255, max = 0;
        
        // Find min and max values
        for (let i = 0; i < data.length; i += 4) {
            const gray = data[i];
            min = Math.min(min, gray);
            max = Math.max(max, gray);
        }
        
        // Apply contrast stretching
        const range = max - min;
        if (range > 0) {
            for (let i = 0; i < data.length; i += 4) {
                const normalized = (data[i] - min) / range;
                const enhanced = normalized * 255;
                data[i] = Math.min(255, Math.max(0, enhanced));
                data[i + 1] = data[i];
                data[i + 2] = data[i];
            }
        }
    }

    applyBasicThreshold(data) {
        // Simple threshold - convert to black and white
        const threshold = 128; // Middle gray value
        
        for (let i = 0; i < data.length; i += 4) {
            const gray = data[i];
            const binary = gray > threshold ? 255 : 0;
            data[i] = binary;
            data[i + 1] = binary;
            data[i + 2] = binary;
        }
    }

    // Adaptive thresholding for uneven lighting (used for width <= 600px)
    applyAdaptiveThreshold(data, width, height) {
        const integralImage = new Float32Array(width * height);
        const integralImageSq = new Float32Array(width * height);
        
        for (let y = 0; y < height; y++) {
            let rowSum = 0;
            let rowSumSq = 0;
            for (let x = 0; x < width; x++) {
                const index = y * width + x;
                const gray = data[index * 4];
                rowSum += gray;
                rowSumSq += gray * gray;
                
                integralImage[index] = (y > 0 ? integralImage[index - width] : 0) + rowSum;
                integralImageSq[index] = (y > 0 ? integralImageSq[index - width] : 0) + rowSumSq;
            }
        }
        
        const windowSize = Math.max(15, Math.floor(width / 8));
        const s = Math.floor(windowSize / 2);
        const t = 0.15;

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const index = y * width + x;
                const x1 = Math.max(0, x - s);
                const y1 = Math.max(0, y - s);
                const x2 = Math.min(width - 1, x + s);
                const y2 = Math.min(height - 1, y + s);
                
                const count = Math.max(1, (x2 - x1 + 1) * (y2 - y1 + 1));

                const sum = integralImage[y2 * width + x2]
                          - (y1 > 0 ? integralImage[(y1 - 1) * width + x2] : 0)
                          - (x1 > 0 ? integralImage[y2 * width + (x1 - 1)] : 0)
                          + (x1 > 0 && y1 > 0 ? integralImage[(y1 - 1) * width + (x1 - 1)] : 0);
                const mean = sum / count;
                
                const gray = data[index * 4];
                const binary = gray > mean * (1.0 - t) ? 255 : 0;
                
                data[index * 4] = binary;
                data[index * 4 + 1] = binary;
                data[index * 4 + 2] = binary;
            }
        }
    }


    testImageSplitting() {
        // Create a test image with multiple rows of text
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        // Set canvas size
        canvas.width = 400;
        canvas.height = 300;
        
        // Fill with white background
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // Add text rows to simulate group member list
        ctx.fillStyle = 'black';
        ctx.font = '16px Arial';
        
        const testData = [
            'John Doe +6281234567890',
            'Jane Smith 081234567891',
            'Bob Johnson +6281234567892',
            'Alice Brown 081234567893',
            'Charlie Wilson +6281234567894',
            'Diana Davis 081234567895',
            'Eve Miller +6281234567896',
            'Frank Garcia 081234567897',
            'Grace Lee +6281234567898',
            'Henry Kim 081234567899'
        ];
        
        testData.forEach((text, index) => {
            const y = 20 + (index * 30);
            ctx.fillText(text, 10, y);
        });
        
        // Convert to blob and process
        canvas.toBlob(async (blob) => {
            const img = new Image();
            img.onload = async () => {
                console.log('=== TEST IMAGE SPLITTING ===');
                console.log('Test image dimensions:', img.width, 'x', img.height);
                // Build a zoomed & preprocessed canvas like in extractContactsFromImage
                const testCanvas = document.createElement('canvas');
                const testCtx = testCanvas.getContext('2d', { willReadFrequently: true });
                const zoomFactor = 2;
                testCanvas.width = img.width * zoomFactor;
                testCanvas.height = img.height * zoomFactor;
                testCtx.imageSmoothingEnabled = true;
                testCtx.imageSmoothingQuality = 'high';
                testCtx.drawImage(img, 0, 0, testCanvas.width, testCanvas.height);
                this.preprocessImageForOCR(testCanvas, testCtx);

                // Split into tiles and log details
                const tileHeight = 900;
                const overlap = 100;
                const tiles = this.splitCanvasIntoVerticalTiles(testCanvas, { tileHeight, overlap });
                console.log(`Tiles generated for test: ${tiles.length} (tileHeight=${tileHeight}, overlap=${overlap})`);
                tiles.slice(0, Math.min(3, tiles.length)).forEach((t, i) => {
                    console.log(`Tile ${i + 1}: top=${t.sectionTop}, height=${t.sectionHeight}`);
                });
                if (tiles.length > 3) {
                    const last = tiles[tiles.length - 1];
                    console.log(`... last tile: top=${last.sectionTop}, height=${last.sectionHeight}`);
                }

                const contacts = await this.extractContactsFromImage(img, 'test-image.png', 'indonesia');
                
                console.log('=== SPLITTING RESULTS ===');
                console.log('Total contacts found:', contacts.length);
                contacts.forEach((contact, index) => {
                    console.log(`Contact ${index + 1}:`, contact);
                });
                
                this.updateStatus(`Test completed: ${tiles.length} tiles, found ${contacts.length} contacts`, 'success');
            };
            img.src = URL.createObjectURL(blob);
        }, 'image/png');
    }

    async loadTesseract() {
        if (typeof Tesseract === 'undefined') {
            try {
                console.log('Loading Tesseract.js from local file...');
                this.updateStatus('Loading OCR engine...', 'info');
                
                // Try different paths for the tesseract file
                const possiblePaths = [
                    './js/tesseract.min.js',
                    'js/tesseract.min.js',
                    '../js/tesseract.min.js',
                    '/js/tesseract.min.js'
                ];
                
                let workingPath = null;
                for (const path of possiblePaths) {
                    try {
                        const testResponse = await fetch(path);
                        if (testResponse.ok) {
                            workingPath = path;
                            console.log(`Tesseract.js file accessible at: ${path}`);
                            break;
                        }
                    } catch (e) {
                        console.log(`Path ${path} not accessible:`, e.message);
                    }
                }
                
                if (!workingPath) {
                    throw new Error('Tesseract.js file not accessible from any path');
                }
                
                const script = document.createElement('script');
                script.src = workingPath;
                script.onload = () => {
                    console.log('Tesseract.js loaded successfully');
                    this.updateStatus('OCR engine loaded successfully', 'success');
                };
                script.onerror = (error) => {
                    console.error('Failed to load Tesseract.js script:', error);
                    this.updateStatus('Failed to load OCR engine script', 'error');
                };
                document.head.appendChild(script);
            } catch (error) {
                console.error('Error loading Tesseract.js:', error);
                this.updateStatus(`Error loading OCR engine: ${error.message}`, 'error');
            }
        } else {
            console.log('Tesseract.js is already available');
            this.updateStatus('OCR engine ready', 'success');
        }
    }

    async initializeWorker() {
        if (this.workerInitialized && this.worker) {
            return this.worker;
        }

        try {
            console.log('Initializing persistent Tesseract worker...');
            this.worker = await Tesseract.createWorker({
                workerPath: chrome.runtime.getURL('js/worker.min.js'),
                corePath: chrome.runtime.getURL('js/tesseract-core-lstm.wasm.js'),
                workerBlobURL: false,
                logger: (m) => {
                    try {
                        const msg = typeof m === 'string' ? m : (m && m.message) ? m.message : '';
                        if (!msg) return;
                        // Suppress noisy internal warnings that confuse users
                        if (msg.includes('Image too small to scale') || msg.includes('Line cannot be recognized')) {
                            return;
                        }
                        console.log('[Tesseract]', msg);
                    } catch (_) {
                        // best-effort logging only
                    }
                }
            });

            await this.worker.loadLanguage('eng');
            await this.worker.initialize('eng');
            
            // Configure for phone number recognition with optimized settings
            await this.worker.setParameters({
                tessedit_char_whitelist: '0123456789+', // Only digits and plus sign
                tessedit_pageseg_mode: '6', // default; may be overridden per-image or per-width
                tessedit_ocr_engine_mode: '1', // Neural nets LSTM only
                tessedit_char_blacklist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!@#$%^&*()_=[]{}|;:,.<>?/~`',
                preserve_interword_spaces: '0',
                tessedit_do_invert: '0', // Don't invert colors
                classify_bln_numeric_mode: '1', // Numeric mode
                textord_min_linesize: '2.5', // Minimum line size
                user_defined_dpi: '300' // Improve recognition on upscaled images
            });

            this.workerInitialized = true;
            console.log('Tesseract worker initialized successfully');
            return this.worker;
        } catch (error) {
            console.error('Failed to initialize Tesseract worker:', error);
            throw error;
        }
    }

    async terminateWorker() {
        if (this.worker && this.workerInitialized) {
            try {
                await this.worker.terminate();
                this.worker = null;
                this.workerInitialized = false;
                console.log('Tesseract worker terminated');
            } catch (error) {
                console.error('Error terminating worker:', error);
            }
        }
    }

    async waitForTesseract() {
        return new Promise((resolve) => {
            let attempts = 0;
            const maxAttempts = 100; // 10 seconds timeout
            
            const checkTesseract = () => {
                if (typeof Tesseract !== 'undefined') {
                    console.log('Tesseract.js is now available');
                    resolve();
                } else if (attempts >= maxAttempts) {
                    console.error('Tesseract.js loading timeout after 10 seconds');
                    resolve();
                } else {
                    attempts++;
                    setTimeout(checkTesseract, 100);
                }
            };
            checkTesseract();
        });
    }

    initializeEventListeners() {
        // File upload handling
        const uploadArea = document.getElementById('upload-area');
        const fileInput = document.getElementById('file-input');
        const startButton = document.getElementById('start-group-scraping');
        const stopButton = document.getElementById('stop-group-scraping');
        const clearButton = document.getElementById('clear-files');
        const exportButton = document.getElementById('export-group-csv');
        const clearResultsButton = document.getElementById('clear-group-results');

        // Advanced controls removed: auto strategy handles dimensions and PSM

        // Click to upload
        uploadArea.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', (e) => this.handleFileSelection(e));

        // Drag and drop
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        });

        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('dragover');
        });

        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
            this.handleFileSelection({ target: { files: e.dataTransfer.files } });
        });

        // Button events
        startButton.addEventListener('click', () => this.startProcessing());
        stopButton.addEventListener('click', () => this.stopProcessing());
        clearButton.addEventListener('click', () => this.clearFiles());
        exportButton.addEventListener('click', () => this.exportToCSV());
        clearResultsButton.addEventListener('click', () => this.clearResults());

        // Navigation is handled by dashboard.js
    }

    handleFileSelection(event) {
        const files = Array.from(event.target.files);
        const validFiles = files.filter(file => {
            const validTypes = ['image/png', 'image/jpeg', 'image/jpg'];
            return validTypes.includes(file.type);
        });

        if (validFiles.length !== files.length) {
            this.updateStatus('Some files were skipped - only PNG, JPG, and JPEG files are supported', 'warning');
        }

        this.selectedFiles = [...this.selectedFiles, ...validFiles];
        this.updateFileList();
        this.updateStartButton();
    }

    updateFileList() {
        const fileList = document.getElementById('file-list');
        const filesContainer = document.getElementById('files-container');
        
        if (this.selectedFiles.length === 0) {
            fileList.style.display = 'none';
            return;
        }

        fileList.style.display = 'block';
        filesContainer.innerHTML = '';

        this.selectedFiles.forEach((file, index) => {
            const fileItem = document.createElement('div');
            fileItem.className = 'file-item';
            
            const fileInfo = document.createElement('div');
            fileInfo.innerHTML = `
                <strong>${file.name}</strong><br>
                <small>${(file.size / 1024 / 1024).toFixed(2)} MB</small>
            `;

            const removeButton = document.createElement('button');
            removeButton.className = 'btn btn-danger btn-sm';
            removeButton.textContent = 'Remove';
            removeButton.addEventListener('click', () => this.removeFile(index));

            fileItem.appendChild(fileInfo);
            fileItem.appendChild(removeButton);
            filesContainer.appendChild(fileItem);
        });
    }

    removeFile(index) {
        this.selectedFiles.splice(index, 1);
        this.updateFileList();
        this.updateStartButton();
    }

    updateStartButton() {
        const startButton = document.getElementById('start-group-scraping');
        startButton.disabled = this.selectedFiles.length === 0 || this.isProcessing;
    }

    async startProcessing() {
        if (this.selectedFiles.length === 0) return;

        this.isProcessing = true;
        this.extractedContacts = [];
        this.updateStartButton();
        this.updateStopButton(true);
        this.updateStatus('Loading OCR engine...', 'info');
        
        // Wait for Tesseract.js to load if not already available
        if (typeof Tesseract === 'undefined') {
            this.updateStatus('Waiting for OCR engine to load...', 'info');
            console.log('Tesseract not available, waiting...');
            await this.waitForTesseract();
        }
        
        // Check if Tesseract.js is available
        if (typeof Tesseract === 'undefined') {
            console.error('Tesseract.js still not available after waiting');
            this.updateStatus('OCR engine not loaded, please refresh the page', 'error');
            this.isProcessing = false;
            this.updateStartButton();
            this.updateStopButton(false);
            return;
        } else {
            console.log('Tesseract.js is available, initializing worker...');
            this.updateStatus('Initializing OCR worker...', 'info');
            
            // Initialize persistent worker
            await this.initializeWorker();
            
            console.log('Starting optimized processing with parallel batches...');
            this.updateStatus('OCR worker ready, starting processing...', 'info');
        }

        const phonePattern = document.getElementById('phone-pattern').value;

        try {
            for (let i = 0; i < this.selectedFiles.length; i++) {
                if (!this.isProcessing) break;

                const file = this.selectedFiles[i];
                this.updateStatus(`Processing file ${i + 1}/${this.selectedFiles.length}: ${file.name}`, 'info');
                this.updateProgress((i / this.selectedFiles.length) * 100);

                this.updateStatus(`Running OCR on ${file.name}...`, 'info');
                const contacts = await this.processImageFile(file, phonePattern);
                this.extractedContacts = [...this.extractedContacts, ...contacts];

                this.updateStatus(`Found ${contacts.length} phone numbers in ${file.name}`, 'success');
                
                // Update results in real-time
                this.updateResults();
            }

            if (this.isProcessing) {
                this.updateStatus(`Processing complete! Found ${this.extractedContacts.length} phone numbers`, 'success');
                this.updateProgress(100);
                this.showResults();
            }
        } catch (error) {
            console.error('Error during processing:', error);
            this.updateStatus(`Error: ${error.message}`, 'error');
        } finally {
            this.isProcessing = false;
            this.updateStartButton();
            this.updateStopButton(false);
            
            // Clean up worker to free memory
            await this.terminateWorker();
        }
    }

    async processImageFile(file, phonePattern) {
        console.log(`Starting processImageFile for ${file.name}`);
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const img = new Image();
                    img.onload = async () => {
                        try {
                            console.log(`Image loaded for ${file.name}, starting extraction...`);
                            const contacts = await this.extractContactsFromImage(img, file.name, phonePattern);
                            console.log(`processImageFile completed for ${file.name} with ${contacts.length} contacts`);
                            resolve(contacts);
                        } catch (error) {
                            console.error(`Error in processImageFile for ${file.name}:`, error);
                            reject(error);
                        }
                    };
                    img.src = e.target.result;
                } catch (error) {
                    console.error(`Error loading image for ${file.name}:`, error);
                    reject(error);
                }
            };
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsDataURL(file);
        });
    }

    async extractContactsFromImage(img, fileName, phonePattern) {
        console.log(`Starting simple OCR extraction for ${fileName}`);
        
        try {
            const contacts = [];
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d', { willReadFrequently: true });

            // Automatic strategy: zoom/psm/tiling derived from image dimensions
            this.isNarrowPortrait = img.width <= 600;
            const strategy = this.determineSectioningStrategy(img.width, img.height);
            const zoomFactor = strategy.zoomFactor;
            canvas.width = img.width * zoomFactor;
            canvas.height = img.height * zoomFactor;

            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

            // Simple preprocessing - just grayscale and basic cleanup
            this.preprocessImageForOCR(canvas, ctx);

            console.log(`Image dimensions: ${img.width}x${img.height}`);
            console.log(`Canvas dimensions: ${canvas.width}x${canvas.height}`);

            // Split per strategy
            const tiles = this.splitCanvasIntoVerticalTiles(canvas, { tileHeight: strategy.tileHeight, overlap: strategy.overlap });
            console.log(`Auto strategy: zoom=${zoomFactor}, PSM=${strategy.psmMode}, tileHeight=${strategy.tileHeight}, overlap=${strategy.overlap}`);
            console.log(`Split into ${tiles.length} tiles for OCR`);
            this.updateStatus(`Running OCR on ${fileName} in ${tiles.length} tiles...`, 'info');

            // Ensure worker PSM follows strategy
            const worker = await this.initializeWorker();
            try {
                // For narrow images (≤600px), try PSM 4 (single column) for better segmentation
                const psm = (img.width <= 600) ? '4' : String(strategy.psmMode);
                await worker.setParameters({ tessedit_pageseg_mode: psm });
            } catch (e) {
                console.warn('Failed to set PSM dynamically, continuing with existing settings:', e?.message || e);
            }

            const isNarrowPortrait = img.width <= 600;
            for (let i = 0; i < tiles.length; i++) {
                const { canvas: tileCanvas } = tiles[i];
                let tileNumbers = [];
                if (isNarrowPortrait) {
                    // Focused bands for right and middle to improve 540px accuracy
                    const width = tileCanvas.width;
                    const height = tileCanvas.height;
                    const bandWidthRight = Math.max(360, Math.floor(width * 0.55));
                    const bandWidthMiddle = Math.max(320, Math.floor(width * 0.5));
                    const overlapX = Math.floor(width * 0.05);

                    // Right band
                    const rightCanvas = document.createElement('canvas');
                    rightCanvas.width = bandWidthRight;
                    rightCanvas.height = height;
                    const rctx = rightCanvas.getContext('2d', { willReadFrequently: true });
                    const rightX = Math.max(0, width - bandWidthRight);
                    rctx.drawImage(tileCanvas, rightX, 0, bandWidthRight, height, 0, 0, bandWidthRight, height);
                    tileNumbers = tileNumbers.concat(await this.performRealOCR(rightCanvas, phonePattern));

                    // Middle band
                    const midCanvas = document.createElement('canvas');
                    midCanvas.width = bandWidthMiddle;
                    midCanvas.height = height;
                    const mctx = midCanvas.getContext('2d', { willReadFrequently: true });
                    const midX = Math.max(0, Math.floor((width - bandWidthMiddle) / 2) - overlapX);
                    const midSrcW = Math.min(width - midX, bandWidthMiddle);
                    mctx.drawImage(tileCanvas, midX, 0, midSrcW, height, 0, 0, midSrcW, height);
                    tileNumbers = tileNumbers.concat(await this.performRealOCR(midCanvas, phonePattern));
                } else {
                    tileNumbers = await this.performRealOCR(tileCanvas, phonePattern);
                }
                console.log(`Tile ${i + 1}/${tiles.length} found ${tileNumbers.length} numbers`);
                tileNumbers.forEach(phone => {
                    contacts.push({
                        file: fileName,
                        section: i + 1,
                        phoneNumber: phone.phoneNumber,
                        confidence: phone.confidence
                    });
                });
            }
            
            console.log(`Total contacts found: ${contacts.length}`);
            
            // Simple deduplication
            const uniqueNumbers = this.removeDuplicatePhoneNumbers(contacts);
            console.log(`Found ${contacts.length} total contacts, ${uniqueNumbers.length} unique after deduplication`);
            return uniqueNumbers;
        } catch (error) {
            console.error(`Error in extractContactsFromImage for ${fileName}:`, error);
            console.error(`Error stack:`, error.stack);
            throw error; // Re-throw to be caught by processImageFile
        }
    }


    async performRealOCR(canvas, phonePattern) {
        try {
            // Guard against very small images that Tesseract cannot handle
            if (!canvas || canvas.width < 3 || canvas.height < 3) {
                console.warn(`Skipping OCR: canvas too small (${canvas ? canvas.width : 0}x${canvas ? canvas.height : 0}), min 3x3 required`);
                return [];
            }

            // Check if Tesseract.js is available
            if (typeof Tesseract === 'undefined') {
                throw new Error('Tesseract.js not loaded');
            }

            // Convert canvas to blob for Tesseract.js (lossless PNG)
            const blob = await new Promise(resolve => {
                canvas.toBlob(resolve, 'image/png');
            });

            // Initialize worker if not already done
            const worker = await this.initializeWorker();

            // Use persistent worker for OCR
            console.log('Starting OCR recognition...');
            const { data: { text, confidence, symbols } } = await worker.recognize(blob);
            console.log('OCR completed');

            console.log('OCR Text extracted:', text);
            console.log('OCR Confidence:', confidence);

            // If overall confidence is low but digits are clear, boost using symbol-level confidence
            let boostedConfidence = confidence;
            try {
                if (Array.isArray(symbols) && symbols.length > 0) {
                    const digitSymbols = symbols.filter(s => /[0-9+]/.test(s.text));
                    if (digitSymbols.length >= 6) {
                        const avgDigitConf = digitSymbols.reduce((a, s) => a + (s.confidence || 0), 0) / digitSymbols.length;
                        // Blend: favor digit-only confidence for phone extraction
                        boostedConfidence = Math.max(confidence, avgDigitConf);
                    }
                }
            } catch (_) {}

            // Extract phone numbers from the text
            const phoneNumbers = this.extractPhoneNumbers(text, phonePattern, boostedConfidence);
            
            return phoneNumbers;
        } catch (error) {
            console.error('OCR Error:', error);
            this.updateStatus(`OCR failed for section: ${error.message}`, 'error');
            throw error;
        }
    }

    extractPhoneNumbers(text, phonePattern, confidence) {
        const phoneNumbers = [];
        
        // Define regex patterns for different phone number formats
        const patterns = this.getPhoneRegexPatterns(phonePattern);
        
        // Clean text: remove spaces/tabs but keep newlines to avoid merging adjacent lines
        const cleanText = text.replace(/[ \t]+/g, '').replace(/\r?\n+/g, '\n').trim();
        
        console.log('Cleaned text for phone extraction:', cleanText);
        
        patterns.forEach(pattern => {
            const matches = cleanText.match(pattern.regex);
            if (matches) {
                console.log(`Pattern ${pattern.name} found matches:`, matches);
                matches.forEach(match => {
                    // Clean up the phone number
                    const cleanPhone = this.cleanPhoneNumber(match);
                    const phoneConfidence = Math.min(confidence / 100, 0.95); // Convert to 0-1 scale, cap at 0.95
                    console.log(`Raw match: ${match}, Cleaned: ${cleanPhone}`);
                    if (cleanPhone && this.isValidPhoneNumber(cleanPhone, phoneConfidence)) {
                        phoneNumbers.push({
                            phoneNumber: cleanPhone, // Changed from 'number' to 'phoneNumber'
                            confidence: phoneConfidence
                        });
                    }
                });
            }
        });

        console.log(`Found ${phoneNumbers.length} phone numbers in text:`, phoneNumbers);
        return phoneNumbers;
    }

    getPhoneRegexPatterns(phonePattern) {
        const patterns = [];
        
        switch (phonePattern) {
            case 'indonesia':
                patterns.push(
                    // Strict: must normalize to start with 62 (allow up to 17 digits total)
                    { regex: /\+62\d{9,16}/g, name: 'Indonesia +62 strict' },
                    { regex: /62\d{9,16}/g, name: 'Indonesia 62 strict' },
                    { regex: /0\d{10,16}/g, name: 'Indonesia 0 local' },
                    // Tolerant with spaces/separators; will be cleaned then normalized to 62
                    { regex: /\+?\s?62[ \t\-]?\d{2,5}[ \t\-]?\d{3,5}[ \t\-]?\d{3,5}/g, name: 'Indonesia 62 separated' },
                    { regex: /0[ \t\-]?\d{2,5}[ \t\-]?\d{3,5}[ \t\-]?\d{3,5}/g, name: 'Indonesia 0 separated' }
                );
                break;
            case 'us':
                patterns.push(
                    { regex: /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, name: 'US Format' },
                    { regex: /\(\d{3}\)\s?\d{3}-\d{4}/g, name: 'US Parentheses' }
                );
                break;
            case 'international':
                patterns.push(
                    { regex: /\+?\d{1,3}[-.\s]?\(?\d{1,4}\)?[-.\s]?\d{1,4}[-.\s]?\d{1,9}/g, name: 'International' },
                    { regex: /\+1[-.\s]?\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/g, name: 'US International' }
                );
                break;
            case 'simple':
                patterns.push(
                    { regex: /\d{10,15}/g, name: 'Simple Numbers' }
                );
                break;
            default: // 'all'
                patterns.push(
                    { regex: /\+62\d{9,10}/g, name: 'Indonesia +62' },
                    { regex: /62\d{9,10}/g, name: 'Indonesia 62' },
                    { regex: /0\d{10,11}/g, name: 'Indonesia Local' },
                    { regex: /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, name: 'US Format' },
                    { regex: /\+?\d{1,3}[-.\s]?\(?\d{1,4}\)?[-.\s]?\d{1,4}[-.\s]?\d{1,9}/g, name: 'International' },
                    { regex: /\d{10,15}/g, name: 'Simple Numbers' }
                );
        }
        
        return patterns;
    }

    cleanPhoneNumber(phone) {
        // Remove all spaces, plus signs, and dashes
        let cleaned = phone.replace(/[\s+\-]/g, '');
        
        // Handle Indonesian phone numbers specifically
        if (cleaned.startsWith('62')) {
            return cleaned;
        } else if (cleaned.startsWith('0')) {
            return '62' + cleaned.substring(1);
        }
        
        // For other formats, remove all non-digit characters
        cleaned = cleaned.replace(/\D/g, '');
        
        // If looks like Indonesian length but missing prefix, normalize to 62
        if (cleaned.length >= 10 && cleaned.length <= 13 && !cleaned.startsWith('62')) {
            cleaned = '62' + cleaned.replace(/^0+/, '');
        }
        
        return cleaned;
    }

    isValidPhoneNumber(phone, confidence = 0) {
        // Remove all non-digit characters for validation
        const digits = phone.replace(/\D/g, '');
        
        console.log(`Validating phone: "${phone}" -> digits: "${digits}" (length: ${digits.length}, confidence: ${confidence})`);
        
        // Basic length validation
        const isValidLength = digits.length >= 10 && digits.length <= 17; // allow longer numbers
        
        // Confidence threshold - reject very low confidence numbers
        const minConfidence = 0.01; // allow low OCR confidence for strong regex matches
        const isValidConfidence = confidence >= minConfidence;
        
        // Additional validation for Indonesian numbers
        const isIndonesianFormat = digits.startsWith('62') && digits.length >= 11 && digits.length <= 17;
        const isLocalFormat = digits.startsWith('0') && digits.length >= 10 && digits.length <= 16;
        
        // Enforce Indonesian normalization: prefer numbers starting with 62
        const isValid = isValidLength && isValidConfidence && (isIndonesianFormat || isLocalFormat);
        
        if (!isValid) {
            console.log(`Phone number rejected: length=${isValidLength}, confidence=${isValidConfidence}, format=${isIndonesianFormat || isLocalFormat}`);
        }
        
        return isValid;
    }

    removeDuplicatePhoneNumbers(phoneNumbers) {
        console.log(`Starting fuzzy deduplication of ${phoneNumbers.length} phone numbers...`);
        
        // First, filter out invalid phone numbers
        const validNumbers = phoneNumbers.filter(phone => {
            if (!phone || !phone.phoneNumber || typeof phone.phoneNumber !== 'string') {
                console.warn('Invalid phone number object:', phone);
                return false;
            }
            return true;
        });
        
        // Apply fuzzy deduplication
        const uniqueNumbers = this.fuzzyDeduplicate(validNumbers);
        
        console.log(`Fuzzy deduplication: ${phoneNumbers.length} -> ${uniqueNumbers.length} unique numbers`);
        return uniqueNumbers;
    }

    fuzzyDeduplicate(phoneNumbers) {
        const unique = [];
        const seen = new Set(); // Fast exact match lookup
        
        for (const phone of phoneNumbers) {
            const normalized = phone.phoneNumber.replace(/\D/g, '');
            let isDuplicate = false;
            
            // Quick exact match check first
            if (seen.has(normalized)) {
                isDuplicate = true;
            } else {
                // Check against existing unique numbers for fuzzy matches
                for (const existing of unique) {
                    const existingNormalized = existing.phoneNumber.replace(/\D/g, '');
                    const distance = this.levenshteinDistance(normalized, existingNormalized);
                    
                    // If very similar (1 character difference) or typical boundary duplication (length diff <= 2), consider duplicate
                    if ((distance <= 1 && Math.abs(normalized.length - existingNormalized.length) <= 1) ||
                        (distance <= 2 && Math.abs(normalized.length - existingNormalized.length) <= 2 &&
                         (normalized.includes(existingNormalized) || existingNormalized.includes(normalized)))) {
                        // Keep the one with higher confidence
                        if (phone.confidence > existing.confidence) {
                            console.log(`Replacing ${existing.phoneNumber} with ${phone.phoneNumber}`);
                            const index = unique.indexOf(existing);
                            unique[index] = phone;
                        } else {
                            console.log(`Skipping duplicate ${phone.phoneNumber} - keeping ${existing.phoneNumber}`);
                        }
                        isDuplicate = true;
                        break;
                    }
                }
            }
            
            if (!isDuplicate) {
                unique.push(phone);
                seen.add(normalized);
            }
        }
        
        return unique;
    }

    levenshteinDistance(str1, str2) {
        const matrix = [];
        
        for (let i = 0; i <= str2.length; i++) {
            matrix[i] = [i];
        }
        
        for (let j = 0; j <= str1.length; j++) {
            matrix[0][j] = j;
        }
        
        for (let i = 1; i <= str2.length; i++) {
            for (let j = 1; j <= str1.length; j++) {
                if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1, // substitution
                        matrix[i][j - 1] + 1,     // insertion
                        matrix[i - 1][j] + 1      // deletion
                    );
                }
            }
        }
        
        return matrix[str2.length][str1.length];
    }

    generateMockPhoneNumbers(pattern) {
        // Generate mock phone numbers for demonstration
        // In a real implementation, this would be replaced with actual OCR
        const mockNumbers = [];
        const numToGenerate = Math.floor(Math.random() * 3) + 1; // 1-3 numbers per section

        for (let i = 0; i < numToGenerate; i++) {
            let phoneNumber;
            switch (pattern) {
                case 'indonesia':
                    // Generate Indonesian phone numbers (11-12 digits total)
                    const indonesianFormats = [
                        `+62${this.randomDigits(9)}`, // +62 + 9 digits = 12 total
                        `+62${this.randomDigits(10)}`, // +62 + 10 digits = 13 total (but we'll clean it)
                        `62${this.randomDigits(9)}`, // 62 + 9 digits = 11 total
                        `62${this.randomDigits(10)}`, // 62 + 10 digits = 12 total
                        `0${this.randomDigits(10)}`, // 0 + 10 digits = 11 total
                        `0${this.randomDigits(11)}` // 0 + 11 digits = 12 total
                    ];
                    phoneNumber = indonesianFormats[Math.floor(Math.random() * indonesianFormats.length)];
                    break;
                case 'us':
                    phoneNumber = `(${this.randomDigits(3)}) ${this.randomDigits(3)}-${this.randomDigits(4)}`;
                    break;
                case 'international':
                    phoneNumber = `+1 ${this.randomDigits(3)} ${this.randomDigits(3)} ${this.randomDigits(4)}`;
                    break;
                case 'simple':
                    phoneNumber = this.randomDigits(10);
                    break;
                default:
                    // Random format including Indonesian
                    const formats = [
                        `+62${this.randomDigits(9)}`,
                        `62${this.randomDigits(9)}`,
                        `0${this.randomDigits(10)}`,
                        `(${this.randomDigits(3)}) ${this.randomDigits(3)}-${this.randomDigits(4)}`,
                        `+1 ${this.randomDigits(3)} ${this.randomDigits(3)} ${this.randomDigits(4)}`,
                        this.randomDigits(10)
                    ];
                    phoneNumber = formats[Math.floor(Math.random() * formats.length)];
            }

            // Clean the phone number using the same cleaning function
            const cleanedNumber = this.cleanPhoneNumber(phoneNumber);

            mockNumbers.push({
                number: cleanedNumber,
                confidence: Math.random() * 0.3 + 0.7 // 70-100% confidence
            });
        }

        return mockNumbers;
    }

    randomDigits(count) {
        let result = '';
        for (let i = 0; i < count; i++) {
            result += Math.floor(Math.random() * 10);
        }
        return result;
    }

    updateResults() {
        const resultsContainer = document.getElementById('group-results-container');
        const resultsCount = document.getElementById('group-results-count');
        const tbody = document.getElementById('results-tbody');

        if (this.extractedContacts.length === 0) {
            resultsContainer.style.display = 'none';
            resultsCount.style.display = 'none';
            return;
        }

        resultsContainer.style.display = 'block';
        resultsCount.style.display = 'block';
        resultsCount.textContent = `${this.extractedContacts.length} phone numbers found`;

        tbody.innerHTML = '';
        this.extractedContacts.forEach(contact => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${contact.file}</td>
                <td>${contact.section}</td>
                <td><span class="phone-number">${contact.phoneNumber}</span></td>
                <td>${Math.round(contact.confidence * 100)}%</td>
            `;
            tbody.appendChild(row);
        });
    }

    showResults() {
        document.getElementById('results-header').style.display = 'block';
        this.updateResults();
    }

    async stopProcessing() {
        this.isProcessing = false;
        this.updateStatus('Processing stopped by user', 'warning');
        this.updateStartButton();
        this.updateStopButton(false);
        
        // Clean up worker when stopping
        await this.terminateWorker();
    }

    clearFiles() {
        this.selectedFiles = [];
        this.updateFileList();
        this.updateStartButton();
        document.getElementById('file-input').value = '';
    }

    clearResults() {
        this.extractedContacts = [];
        document.getElementById('results-header').style.display = 'none';
        document.getElementById('group-results-container').style.display = 'none';
        document.getElementById('group-results-count').style.display = 'none';
        this.updateStatus('Results cleared', 'info');
    }

    exportToCSV() {
        if (this.extractedContacts.length === 0) {
            this.updateStatus('No contacts to export', 'warning');
            return;
        }

        const csvContent = this.generateCSV();
        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `group_contacts_${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        this.updateStatus(`Exported ${this.extractedContacts.length} contacts to CSV`, 'success');
    }

    generateCSV() {
        const headers = ['File', 'Section', 'Phone Number', 'Confidence'];
        const rows = this.extractedContacts.map(contact => [
            contact.file,
            contact.section,
            // Force Excel text: prefix apostrophe avoids formula parsing and preserves repeats like 11
            `'${contact.phoneNumber}`,
            Math.round(contact.confidence * 100) + '%'
        ]);

        return [headers, ...rows].map(row => 
            row.map(field => `"${field}"`).join(',')
        ).join('\n');
    }

    updateStatus(message, type = 'info') {
        const statusElement = document.getElementById('group-status');
        statusElement.textContent = message;
        statusElement.className = `status-${type}`;
    }

    updateProgress(percentage) {
        const progressElement = document.getElementById('group-progress');
        progressElement.style.width = `${percentage}%`;
    }

    updateStopButton(show) {
        const stopButton = document.getElementById('stop-group-scraping');
        if (show) {
            stopButton.classList.remove('hidden');
        } else {
            stopButton.classList.add('hidden');
        }
    }
}

// Global instance for dashboard integration
let groupContactScraper = null;

// Initialize function for dashboard
function initGroupContactScraper() {
    if (!groupContactScraper) {
        groupContactScraper = new GroupContactScraper();
    }
    groupContactScraper.initialize();
}

// Make function globally available
window.initGroupContactScraper = initGroupContactScraper;
