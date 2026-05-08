/*
    script.js
    - Loads face-api models (via public hosted models)
    - Starts/stops the webcam
    - Runs face expression detection and maps to moods
    - Saves detected moods to localStorage and updates a Chart.js chart
*/

const STORAGE_KEY = 'sentient_moods_v1'
let moods = []
let stream = null
let detecting = false
let detectorInterval = null
let emotionChart = null
let eyesClosedStart = null
const EYE_AR_THRESH = 0.20 // eye aspect ratio threshold
const EYE_AR_CONSEC_MS = 4000 // milliseconds eyes must remain closed
let overlaysEnabled = true
let analyticsChart = null
const CHAT_KEY = 'mood_ana_chat_v1'
const BREAK_PREF_KEY = 'mood_ana_break_pref'
let chatMessages = []

// --- Simple client-side auth (demo) ---
function saveUser(u){ localStorage.setItem('sw_user', JSON.stringify(u)) }
function getUser(){ try{return JSON.parse(localStorage.getItem('sw_user'))}catch(e){return null} }
function clearUser(){ localStorage.removeItem('sw_user') }

function showLoggedIn(user){
    const loginMsg = q('loginMsg')
    const logoutBtn = q('logoutBtn')
    const loginBtn = q('loginBtn')
    if(user){
        loginMsg.textContent = `Signed in as ${user.name}`
        loginBtn.style.display = 'none'
        logoutBtn.style.display = ''
    }else{
        loginMsg.textContent = 'Not signed in'
        loginBtn.style.display = ''
        logoutBtn.style.display = 'none'
    }
}

function computeAnalytics(){
    loadMoods()
    const total = moods.length
    const counts = moods.reduce((acc,m)=>{acc[m.label]=(acc[m.label]||0)+1; return acc},{})
    const avgScore = moods.reduce((s,m)=>s+(m.score||0),0) / (total||1)
    const noAttention = counts['No attention']||0
    return {total, counts, avgScore: Number(avgScore.toFixed(2)), noAttention}
}

function loadChat(){
    try{chatMessages = JSON.parse(localStorage.getItem(CHAT_KEY)) || []}catch(e){chatMessages=[]}
}

function saveChat(){
    localStorage.setItem(CHAT_KEY, JSON.stringify(chatMessages))
}

function loadBreakPreference(){
    const minutes = Number(localStorage.getItem(BREAK_PREF_KEY))
    return minutes > 0 ? minutes : 0
}

function saveBreakPreference(minutes){
    if(!minutes || minutes <= 0) return
    localStorage.setItem(BREAK_PREF_KEY, String(minutes))
    updateBreakPreferenceUI(minutes)
}

function updateBreakPreferenceUI(minutes){
    const prefEl = q('break-pref')
    const durationInput = q('break-duration')
    if(prefEl) prefEl.textContent = `${minutes} min`
    if(durationInput) durationInput.value = minutes
}

function getBreakDuration(){
    const input = q('break-duration')
    const stored = loadBreakPreference()
    const value = input ? Number(input.value) : 0
    if(value > 0) return value
    return stored > 0 ? stored : recommendBreak()
}

function addChatMessage(sender,text){
    chatMessages.push({sender,text,ts:Date.now()})
    saveChat()
    renderChat()
}

function renderChat(){
    const container = q('chatMessages')
    if(!container) return
    container.innerHTML = ''
    chatMessages.slice(-20).forEach(msg=>{
        const el = document.createElement('div')
        el.className = `chatbot-message ${msg.sender}`
        el.textContent = msg.text
        container.appendChild(el)
    })
    container.scrollTop = container.scrollHeight
}

function pickResponse(choices){
    return choices[Math.floor(Math.random()*choices.length)]
}

function generateChatReply(input, user, moodLabel){
    const text = input.trim()
    const name = user?.name || 'friend'
    const base = text.toLowerCase()
    const greetings = ['I hear you.', 'Thanks for sharing.', 'That sounds important.']
    const moodHint = moodLabel ? `I see your current mood is ${moodLabel.toLowerCase()}. ` : ''
    let response = ''

    const mentionNeed = ['help','support','advice','need','struggle','hard']
    const mentionStress = ['stress','stressed','anxiety','anxious','overwhelmed']
    const mentionSad = ['sad','down','depressed','unhappy','blue']
    const mentionHappy = ['happy','good','great','better','awesome']
    const mentionTired = ['tired','sleep','exhausted','drained']
    const mentionMood = ['feel','feeling','mood']

    const containsAny = (arr)=>arr.some(term=>base.includes(term))

    if(containsAny(mentionStress)){
        response = pickResponse([
            `I'm sorry that stress is weighing on you, ${name}. Would you like a gentle breathing suggestion?`,
            `Stress can feel heavy. Take a moment to notice one small thing that feels okay right now.`
        ])
    } else if(containsAny(mentionSad)){
        response = pickResponse([
            `It makes sense to feel sad sometimes. I'm here to listen if you want to share more.`,
            `Thank you for opening up. Would you like a small self-care idea to try together?`
        ])
    } else if(containsAny(mentionTired)){
        response = pickResponse([
            `Feeling tired is valid. A brief pause or a few gentle breaths can help reset.`,
            `You sound exhausted. What would help you feel a bit lighter right now?`
        ])
    } else if(containsAny(mentionHappy)){
        response = pickResponse([
            `That's great to hear, ${name}. What helped brighten your mood today?`,
            `I'm glad you're feeling good. Keep noticing those positive moments.`
        ])
    } else if(containsAny(mentionNeed) || base.endsWith('?')){
        response = pickResponse([
            `I'm here to support you. Tell me more about what you're feeling.`,
            `Let's explore that together. What part of this matters most to you?`
        ])
    } else if(base.length < 20){
        response = pickResponse([
            `I appreciate you sharing that. Can you tell me a little more?`,
            `I'm listening. What do you notice in your feelings right now?`
        ])
    } else {
        response = pickResponse([
            `That's helpful to know. What would feel supportive in this moment?`,
            `Thanks for sharing that, ${name}. Would you like a simple suggestion to help you relax?`
        ])
    }

    return `${pickResponse(greetings)} ${moodHint}${response}`
}

function getLastMoodLabel(){
    const last = moods.length && moods[moods.length-1]
    return last ? last.label : ''
}

function handleChatMessage(input){
    const trimmed = input.trim()
    if(!trimmed) return
    const user = getUser()
    addChatMessage('user', trimmed)
    const reply = generateChatReply(trimmed, user, getLastMoodLabel())
    setTimeout(()=> addChatMessage('bot', reply), 300)
}

function initChat(){
    loadChat()
    if(!chatMessages.length){
        const user = getUser()
        const name = user?.name || 'friend'
        addChatMessage('bot', `Hi ${name}, I'm here to support you in this moment. How are you feeling today?`)
    } else {
        renderChat()
    }
}

function q(id){return document.getElementById(id)}

function computeAnalytics(){
    loadMoods()
    const total = moods.length
    const counts = moods.reduce((acc,m)=>{acc[m.label]=(acc[m.label]||0)+1; return acc},{})
    const avgScore = moods.reduce((s,m)=>s+(m.score||0),0) / (total||1)
    const noAttention = counts['No attention']||0
    return {total, counts, avgScore: Number(avgScore.toFixed(2)), noAttention}
}

function renderAnalytics(){
    const statEntries = q('stat-entries')
    const statAvg = q('stat-avg')
    const statNo = q('stat-noattention')
    const c = computeAnalytics()
    if(statEntries) statEntries.textContent = c.total
    if(statAvg) statAvg.textContent = c.avgScore
    if(statNo) statNo.textContent = c.noAttention

    // draw simple bar of counts
    const ctx = q('progressChart') && q('progressChart').getContext('2d')
    if(!ctx) return
    const labels = Object.keys(c.counts)
    const data = labels.map(l=>c.counts[l])
    if(analyticsChart) analyticsChart.destroy()
    analyticsChart = new Chart(ctx,{type:'bar',data:{labels,data: data, datasets:[{label:'Count',data,backgroundColor:'#60a5fa'}]}})
}

function recommendBreak(){
    const a = computeAnalytics()
    // heuristic: poor avg or many no-attention -> longer break
    let mins = 5
    if(a.avgScore <= 2.5) mins = 20
    else if(a.avgScore < 3.5) mins = 10
    if(a.noAttention > Math.max(3, a.total*0.15)) mins = Math.max(mins, 20)
    return mins
}

function startBreak(minutes){
    const status = q('break-status')
    if(!minutes || minutes<=0) return
    const end = Date.now() + minutes*60000
    q('break-status').textContent = `Break started: ${minutes} minute(s).` 
    const iv = setInterval(()=>{
        const remain = Math.max(0, end - Date.now())
        const m = Math.floor(remain/60000)
        const s = Math.floor((remain%60000)/1000)
        q('break-status').textContent = `Break: ${m}m ${s}s remaining`
        if(remain<=0){
            clearInterval(iv)
            q('break-status').textContent = `Break finished. Ready to resume.`
            // optional sound or notification
            try{ new Notification('Break finished') }catch(e){}
        }
    },1000)
}

const MODEL_URL = 'https://justadudewhohacks.github.io/face-api.js/models'

async function loadModels(){
    try{
        q('loading').textContent = 'Loading models...'
        // load both models used for detection and expressions
        await Promise.all([
            faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
            faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL),
            faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL)
        ])
        q('loading').textContent = 'Models loaded'
        q('toggleCamera').disabled = false
        return true
    }catch(e){
        console.warn('Remote model load failed, attempting local models...', e)
        // try local fallback (./models folder in project)
        try{
            const LOCAL = './models'
            await Promise.all([
                faceapi.nets.tinyFaceDetector.loadFromUri(LOCAL),
                faceapi.nets.faceExpressionNet.loadFromUri(LOCAL),
                faceapi.nets.faceLandmark68Net.loadFromUri(LOCAL)
            ])
            q('loading').textContent = 'Models loaded (local)'
            q('toggleCamera').disabled = false
            return true
        }catch(err){
            q('loading').textContent = 'Model load failed — camera detection unavailable'
            q('toggleCamera').disabled = true
            console.error('Model load error',err)
            // provide brief hint in console for remediation
            console.info('To enable camera-based detection, download the face-api.js model files and place them in a `models` folder next to your HTML. See: https://github.com/justadudewhohacks/face-api.js/tree/master/weights')
            return false
        }
    }
}

async function startCamera(){
    try{
        stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:'user'}, audio:false})
        q('video').srcObject = stream
        q('toggleCamera').textContent = 'Stop Camera'
        detecting = true
        runDetectionLoop()
    }catch(e){
        console.error('Camera error',e)
        q('status').textContent = 'Camera access denied or not available'
    }
}

function stopCamera(){
    if(stream){
        stream.getTracks().forEach(t=>t.stop())
        stream = null
    }
    q('video').srcObject = null
    q('toggleCamera').textContent = 'Start Camera'
    detecting = false
    if(detectorInterval){
        clearInterval(detectorInterval)
        detectorInterval = null
    }
}

function mapExpressionToMood(expr){
    // expr: object of expressions probabilities
    const sorted = Object.entries(expr).sort((a,b)=>b[1]-a[1])
    const top = sorted[0] || ['neutral',0]
    const name = top[0]
    const value = Math.round((top[1]||0)*100)
    if(name==='happy') return {label:'Happy',emoji:'😄',confidence:value}
    if(name==='sad') return {label:'Sad',emoji:'😢',confidence:value}
    if(name==='angry') return {label:'Angry',emoji:'😠',confidence:value}
    if(name==='surprised') return {label:'Surprised',emoji:'😲',confidence:value}
    return {label:'Neutral',emoji:'😐',confidence:value}
}

function euclid(a,b){
    const dx = a.x - b.x
    const dy = a.y - b.y
    return Math.hypot(dx,dy)
}

function eyeAspectRatio(eye){
    // eye: array of points (Point objects with x,y)
    // formula: (|p2-p6| + |p3-p5|) / (2*|p1-p4|)
    if(!eye || eye.length < 6) return 1
    const p1 = eye[0], p2 = eye[1], p3 = eye[2], p4 = eye[3], p5 = eye[4], p6 = eye[5]
    const A = euclid(p2,p6)
    const B = euclid(p3,p5)
    const C = euclid(p1,p4)
    if(C === 0) return 1
    return (A + B) / (2.0 * C)
}

function isEyesClosed(landmarks){
    try{
        const left = landmarks.getLeftEye()
        const right = landmarks.getRightEye()
        const leftEAR = eyeAspectRatio(left)
        const rightEAR = eyeAspectRatio(right)
        const ear = (leftEAR + rightEAR) / 2
        return ear < EYE_AR_THRESH
    }catch(e){
        return false
    }
}

function isLookingAway(landmarks, box){
    // Simple heuristic: compute midpoint between eye centers and compare to box center
    try{
        const left = landmarks.getLeftEye()
        const right = landmarks.getRightEye()
        const leftCenter = left.reduce((acc,p)=>({x:acc.x+p.x,y:acc.y+p.y}),{x:0,y:0})
        leftCenter.x /= left.length; leftCenter.y /= left.length
        const rightCenter = right.reduce((acc,p)=>({x:acc.x+p.x,y:acc.y+p.y}),{x:0,y:0})
        rightCenter.x /= right.length; rightCenter.y /= right.length
        const eyeCenterX = (leftCenter.x + rightCenter.x) / 2
        const faceCenterX = box.x + box.width/2
        // if eyes midpoint deviates horizontally more than 18% of face width => likely looking away
        const deviation = Math.abs(eyeCenterX - faceCenterX)
        return deviation > (box.width * 0.18)
    }catch(e){
        return false
    }
}

function getLookingDeviation(landmarks, box){
    try{
        const left = landmarks.getLeftEye()
        const right = landmarks.getRightEye()
        const leftCenter = left.reduce((acc,p)=>({x:acc.x+p.x,y:acc.y+p.y}),{x:0,y:0})
        leftCenter.x /= left.length; leftCenter.y /= left.length
        const rightCenter = right.reduce((acc,p)=>({x:acc.x+p.x,y:acc.y+p.y}),{x:0,y:0})
        rightCenter.x /= right.length; rightCenter.y /= right.length
        const eyeCenterX = (leftCenter.x + rightCenter.x) / 2
        const faceCenterX = box.x + box.width/2
        const deviation = Math.abs(eyeCenterX - faceCenterX)
        return {deviation, faceWidth: box.width, pct: box.width? (deviation/box.width) : 0}
    }catch(e){
        return {deviation:0, faceWidth:0, pct:0}
    }
}

function getOverlayCtx(){
    const canvas = q('overlay')
    const video = q('video')
    if(!canvas || !video) return null
    // size canvas to video
    const w = video.videoWidth || video.clientWidth || 640
    const h = video.videoHeight || video.clientHeight || 480
    if(canvas.width !== w || canvas.height !== h){
        canvas.width = w
        canvas.height = h
    }
    const ctx = canvas.getContext('2d')
    return ctx
}

function drawOverlay(ctx, res){
    if(!ctx) return
    ctx.clearRect(0,0,ctx.canvas.width,ctx.canvas.height)
    if(!res) return
    // draw detection box
    const box = res.detection.box
    ctx.strokeStyle = 'lime'
    ctx.lineWidth = 2
    ctx.strokeRect(box.x, box.y, box.width, box.height)

    // draw all landmark points faintly
    ctx.fillStyle = 'rgba(255,255,255,0.12)'
    res.landmarks.positions.forEach(p=>{
        ctx.beginPath(); ctx.arc(p.x, p.y, 1.5, 0, Math.PI*2); ctx.fill()
    })

    // highlight eyes
    const left = res.landmarks.getLeftEye()
    const right = res.landmarks.getRightEye()
    ctx.fillStyle = 'cyan'
    left.forEach(p=>{ ctx.beginPath(); ctx.arc(p.x,p.y,2.5,0,Math.PI*2); ctx.fill() })
    right.forEach(p=>{ ctx.beginPath(); ctx.arc(p.x,p.y,2.5,0,Math.PI*2); ctx.fill() })

    // draw eye centers and face center
    const leftCenter = left.reduce((a,p)=>({x:a.x+p.x,y:a.y+p.y}),{x:0,y:0}); leftCenter.x/=left.length; leftCenter.y/=left.length
    const rightCenter = right.reduce((a,p)=>({x:a.x+p.x,y:a.y+p.y}),{x:0,y:0}); rightCenter.x/=right.length; rightCenter.y/=right.length
    const eyeCenterX = (leftCenter.x + rightCenter.x)/2
    const eyeCenterY = (leftCenter.y + rightCenter.y)/2
    const faceCenterX = box.x + box.width/2
    const faceCenterY = box.y + box.height/2

    ctx.fillStyle = 'orange'
    ctx.beginPath(); ctx.arc(eyeCenterX, eyeCenterY, 4, 0, Math.PI*2); ctx.fill()
    ctx.fillStyle = 'red'
    ctx.beginPath(); ctx.arc(faceCenterX, faceCenterY, 4, 0, Math.PI*2); ctx.fill()

    // draw line between eye center and face center
    ctx.strokeStyle = 'yellow'
    ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.moveTo(eyeCenterX, eyeCenterY); ctx.lineTo(faceCenterX, faceCenterY); ctx.stroke()
}

function saveMoodEntry(mood){
    moods.push({...mood, ts: Date.now()})
    localStorage.setItem(STORAGE_KEY, JSON.stringify(moods))
}

function loadMoods(){
    const raw = localStorage.getItem(STORAGE_KEY)
    if(raw) moods = JSON.parse(raw)
}

function updateUIFromMood(m){
    q('mood-display').textContent = m.label
    q('mood-emoji').textContent = m.emoji
    q('conf-happy').textContent = (m.happy||'--') + '%'
    q('conf-sad').textContent = (m.sad||'--') + '%'
    q('conf-neutral').textContent = (m.neutral||'--') + '%'
}

function initChart(){
    const ctx = q('emotionChart').getContext('2d')
    const labels = moods.map(m=>new Date(m.ts).toLocaleTimeString())
    const data = moods.map(m=>m.score||0)
    if(emotionChart) emotionChart.destroy()
    emotionChart = new Chart(ctx,{
        type:'line',
        data:{labels, datasets:[{label:'Mood score',data, borderColor:'#6366f1', backgroundColor:'rgba(99,102,241,0.12)', tension:0.3}]},
        options:{responsive:true, maintainAspectRatio:true}
    })
}

function updateChart(){
    if(!emotionChart) return initChart()
    emotionChart.data.labels = moods.map(m=>new Date(m.ts).toLocaleTimeString())
    emotionChart.data.datasets[0].data = moods.map(m=>m.score||0)
    emotionChart.update()
}

async function runDetectionLoop(){
    // run every 700ms
    if(!detecting) return
    const video = q('video')
    const options = new faceapi.TinyFaceDetectorOptions({inputSize:224, scoreThreshold:0.5})
    // avoid creating multiple intervals
    if(detectorInterval){
        clearInterval(detectorInterval)
        detectorInterval = null
    }
    detectorInterval = setInterval(async ()=>{
        if(video.readyState < 2) return
        try{
            const res = await faceapi.detectSingleFace(video, options).withFaceLandmarks().withFaceExpressions()
            const overlayCtx = getOverlayCtx()
            if(res && res.expressions){
                if(overlaysEnabled && overlayCtx) drawOverlay(overlayCtx, res)
                // baseline mood from expression
                let mood = mapExpressionToMood(res.expressions)
                // attach raw confidences
                mood.happy = Math.round((res.expressions.happy||0)*100)
                mood.sad = Math.round((res.expressions.sad||0)*100)
                mood.neutral = Math.round((res.expressions.neutral||0)*100)

                // attention checks: looking away OR eyes closed for >= EYE_AR_CONSEC_MS
                const eyesClosedNow = res.landmarks ? isEyesClosed(res.landmarks) : false
                // compute EAR for diagnostics
                let ear = 0
                try{
                    const left = res.landmarks.getLeftEye()
                    const right = res.landmarks.getRightEye()
                    const leftEAR = eyeAspectRatio(left)
                    const rightEAR = eyeAspectRatio(right)
                    ear = (leftEAR + rightEAR) / 2
                }catch(e){ ear = 0 }
                const lookDev = res.landmarks ? getLookingDeviation(res.landmarks, res.detection.box) : {deviation:0,faceWidth:0,pct:0}
                const lookingAway = lookDev.pct > 0.18
                if(eyesClosedNow){
                    if(!eyesClosedStart) eyesClosedStart = Date.now()
                }else{
                    eyesClosedStart = null
                }
                const eyesClosedDuration = eyesClosedStart ? (Date.now() - eyesClosedStart) : 0

                if(lookingAway || eyesClosedDuration >= EYE_AR_CONSEC_MS){
                    mood = {label:'No attention', emoji:'🚫', confidence: Math.max(mood.confidence||0, (eyesClosedDuration>=EYE_AR_CONSEC_MS)?100:90)}
                    // zero-out individual confidences to indicate attention loss
                    mood.happy = 0; mood.sad = 0; mood.neutral = 0
                    mood.score = 0
                }else{
                    // score: map happy:5 ... sad:1
                    const scoreMap = {happy:5, neutral:3, sad:1, angry:2, surprised:4}
                    const top = Object.entries(res.expressions).sort((a,b)=>b[1]-a[1])[0] || ['neutral',0]
                    mood.score = scoreMap[top[0]]||3
                }
                // attach raw confidences
                updateUIFromMood(mood)
                saveMoodEntry(mood)
                updateChart()
                q('status').textContent = `Detected: ${mood.label} (${mood.confidence||'--'}%)`

                // Populate diagnostics UI
                const earEl = q('diag-ear')
                const closedEl = q('diag-closed')
                const devEl = q('diag-deviation')
                const statEl = q('diag-status')
                if(earEl) earEl.textContent = ear ? ear.toFixed(2) : '--'
                if(closedEl) closedEl.textContent = (eyesClosedDuration/1000).toFixed(1)
                if(devEl) devEl.textContent = (lookDev.pct*100).toFixed(1) + '%'
                if(statEl) statEl.textContent = (mood.label === 'No attention') ? 'No attention' : 'Attentive'
            }else{
                // clear overlay when no face
                const overlayCtx2 = getOverlayCtx()
                if(overlayCtx2) overlayCtx2.clearRect(0,0,overlayCtx2.canvas.width, overlayCtx2.canvas.height)
                q('status').textContent = 'No face detected'
            }
        }catch(e){
            console.error('Detect error',e)
            q('status').textContent = 'Detection error'
        }
    },700)
}

// Init on load
document.addEventListener('DOMContentLoaded', ()=>{
    loadMoods()
    initChart()
    // show last mood if any
    if(moods.length){
        const last = moods[moods.length-1]
        updateUIFromMood(last)
        q('status').textContent = 'Loaded previous data'
    }

    // Attach toggle after DOM ready (camera requires sign-in)
    const toggle = q('toggleCamera')
    if(toggle){
        toggle.addEventListener('click', async ()=>{
            // enforce sign-in before allowing camera
            const currentUser = getUser()
            if(!currentUser){
                const msgEl = q('loginMsg')
                if(msgEl) msgEl.textContent = 'Please sign in to start the camera.'
                return
            }
            // prevent double clicks while models are loading
            if(toggle.disabled) return
            toggle.disabled = true
            if(!stream){
                const ok = await loadModels()
                toggle.disabled = false
                if(!ok) return
                await startCamera()
            }else{
                stopCamera()
                toggle.disabled = false
            }
        })
    }

    // Overlay toggle
    const overlayToggle = q('toggleOverlay')
    if(overlayToggle){
        overlayToggle.addEventListener('click', ()=>{
            overlaysEnabled = !overlaysEnabled
            overlayToggle.textContent = overlaysEnabled ? 'Hide Overlays' : 'Show Overlays'
            // clear overlay when disabled
            if(!overlaysEnabled){
                const ctx = getOverlayCtx()
                if(ctx) ctx.clearRect(0,0,ctx.canvas.width, ctx.canvas.height)
            }
        })
    }

    // Login handlers
    const loginBtn = q('loginBtn')
    const logoutBtn = q('logoutBtn')
    if(loginBtn){
        loginBtn.addEventListener('click', ()=>{
            const name = q('loginUser') && q('loginUser').value.trim()
            if(!name){ q('loginMsg').textContent = 'Enter a name'; return }
            saveUser({name})
            showLoggedIn({name})
            renderAnalytics()
            // enable camera start when signed in
            const tb = q('toggleCamera')
            if(tb) tb.disabled = false
        })
    }
    if(logoutBtn){
        logoutBtn.addEventListener('click', ()=>{
            clearUser()
            showLoggedIn(null)
            // stop camera and disable start button when signed out
            if(stream) stopCamera()
            const tb = q('toggleCamera')
            if(tb) tb.disabled = true
        })
    }

    // initialize login state and analytics
    const user = getUser()
    showLoggedIn(user)
    renderAnalytics()
    // disable camera start unless signed in
    if(toggle) toggle.disabled = !user

    // Break planner wiring
    const reco = q('break-reco')
    if(reco) reco.textContent = recommendBreak() + ' min'

    const preferred = loadBreakPreference()
    if(preferred > 0){
        updateBreakPreferenceUI(preferred)
    } else {
        const prefEl = q('break-pref')
        if(prefEl) prefEl.textContent = 'not set'
    }

    const startBreakBtn = q('start-break')
    if(startBreakBtn){
        startBreakBtn.addEventListener('click', ()=>{
            const val = getBreakDuration()
            startBreak(val)
        })
    }

    const savePrefBtn = q('save-break-pref')
    if(savePrefBtn){
        savePrefBtn.addEventListener('click', ()=>{
            const minutes = Number(q('break-duration') && q('break-duration').value)
            if(minutes > 0){
                saveBreakPreference(minutes)
                q('break-status').textContent = `Saved preferred break length: ${minutes} min.`
            }
        })
    }

    const presets = document.querySelectorAll('.break-presets button')
    presets.forEach(btn=>{
        btn.addEventListener('click', ()=>{
            const minutes = Number(btn.dataset.min)
            const input = q('break-duration')
            if(input && minutes > 0){
                input.value = minutes
                startBreak(minutes)
            }
        })
    })

    // Manual buttons fallback
    const manual = document.getElementById('manualButtons')
    if(manual){
        manual.querySelectorAll('button').forEach(b=>{
            b.addEventListener('click', ()=>{
                const label = b.getAttribute('data-label') || b.textContent.trim()
                const mood = {label, emoji: label==='Happy'?'😄':label==='Sad'?'😢':label==='Neutral'?'😐':'😣', confidence: 100, score: label==='Happy'?5:label==='Sad'?1:3}
                updateUIFromMood(mood)
                saveMoodEntry(mood)
                updateChart()
                q('status').textContent = 'Manual entry saved'
            })
        })
    }

    initChat()
    const chatForm = q('chatForm')
    if(chatForm){
        chatForm.addEventListener('submit', e=>{
            e.preventDefault()
            const input = q('chatInput')
            if(!input) return
            handleChatMessage(input.value)
            input.value = ''
            input.focus()
        })
    }
})