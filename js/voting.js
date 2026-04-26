// ════════════════════════════════════════════════
// EPSA VOTING SYSTEM
// ════════════════════════════════════════════════

let votingState = { phase: null, selectedCandidate: null, hasVoted: false, myVoteId: null, nominees: [], compareMode: false, compareIds: [] };

async function loadVoting() {
  const grid = document.getElementById('candidateGrid'); if (!grid) return;
  
  try {
    const res = await API.request('/voting/candidates?phase=1'); 
    
    if (!res.active) {
      document.getElementById('sec-voting').innerHTML = `
        <div style="text-align:center;padding:var(--space-8);color:var(--text-muted);">
          <h2>No Active Election</h2>
          <p>Please check back later when an election phase begins.</p>
        </div>`;
      return;
    }
    
    votingState.phase = res.phase;
    votingState.nominees = res.candidates;
    votingState.hasVoted = !!res.my_vote_id;
    votingState.myVoteId = res.my_vote_id;
    
    if (res.phase.phase_number === 2) {
       document.getElementById('votingPhaseTitle').textContent = `Phase 2 — National Executive Board`;
       document.getElementById('votingPhaseDesc').textContent = `Ranked national voting for the NEB. Top three candidates become President, VP, and Secretary General.`;
    } else {
       document.getElementById('votingPhaseTitle').textContent = `Phase 1 — University Representatives`;
       document.getElementById('votingPhaseDesc').textContent = `Vote for your university's EPSA representative. Only students within your campus can vote.`;
    }
    
    startVotingCountdown(res.phase.ends_at);
    renderCandidates(res.candidates);
    
    // Check if I already nominated myself this phase
    const myNom = res.candidates.find(c => c.is_me);
    if (myNom) {
       const nomBtn = document.getElementById('nominateBtn');
       if (nomBtn) {
          nomBtn.textContent = '✓ Nominated'; 
          nomBtn.disabled = true; 
          nomBtn.classList.remove('btn-gold'); 
          nomBtn.classList.add('btn-ghost');
       }
    }
    
    // Lock controls if already voted
    if (votingState.hasVoted) {
      document.getElementById('voteInstructionText').innerHTML = '✅ <span style="color:var(--epsa-green);font-weight:700;">You have already voted</span>';
      const nomBtn = document.getElementById('nominateBtn');
      if (nomBtn) nomBtn.style.display = 'none';
      const cmpBtn = document.getElementById('compareBtn');
      if (cmpBtn) cmpBtn.style.display = 'none';
    }

  } catch (err) {
    console.error(err);
    showToast('Failed to load voting data', 'error');
  }
}
window.loadVoting = loadVoting;

function renderCandidates(candidates) {
  const grid = document.getElementById('candidateGrid'); if (!grid) return;
  
  if (candidates.length === 0) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:var(--space-6);color:var(--text-muted);background:var(--light-100);border-radius:var(--radius-lg);">No candidates approved yet.</div>`;
    return;
  }
  
  grid.innerHTML = candidates.map(c => {
    const isMyChoice = votingState.hasVoted && votingState.myVoteId === c.user_id;
    const isMe = c.is_me === true;
    const isPending = isMe && c.is_approved !== 1;
    const initials = c.name.split(' ').map(n=>n[0]).join('').substring(0,2).toUpperCase();
    const isCompareSelected = votingState.compareMode && votingState.compareIds.includes(c.id);
    
    return `
    <div class="candidate-card ${isMyChoice ? 'voted' : ''} ${isCompareSelected ? 'selected' : ''}"
         id="candidate-${c.id}" style="${votingState.compareMode ? 'cursor:pointer;' : ''} position:relative;"
         onclick="${votingState.compareMode ? `toggleCompareCandidate(${c.id})` : ''}">
      
      ${votingState.compareMode ? `<div style="position:absolute;top:10px;right:10px;font-size:1.2rem;">${isCompareSelected ? '☑️' : '⬜'}</div>` : ''}
      
      ${isMe ? `<div style="position:absolute;top:10px;left:10px;background:var(--epsa-gold);color:white;padding:2px 8px;border-radius:var(--radius-full);font-size:0.6rem;font-weight:700;text-transform:uppercase;">You</div>` : ''}
      ${isPending ? `<div style="position:absolute;top:10px;right:10px;background:#eab308;color:white;padding:2px 8px;border-radius:var(--radius-full);font-size:0.6rem;font-weight:700;text-transform:uppercase;">Pending Review</div>` : ''}

      <div style="width:80px;height:80px;border-radius:50%;background:linear-gradient(135deg,var(--epsa-green),var(--epsa-gold));display:flex;align-items:center;justify-content:center;color:white;font-weight:800;font-size:1.3rem;margin:0 auto var(--space-3); overflow:hidden; border: 3px solid white; box-shadow: var(--shadow-sm); ${isPending ? 'opacity:0.6;' : ''}">
        ${c.profile_photo ? `<img src="${API.toAbsoluteUrl(c.profile_photo.startsWith('/') ? c.profile_photo : `/${c.profile_photo}`)}" style="width:100%;height:100%;object-fit:cover;">` : initials}
      </div>
      <div class="candidate-name" style="${isPending ? 'color:var(--text-muted);' : ''}">${c.name}</div>
      <div class="candidate-uni" style="${isPending ? 'opacity:0.7;' : ''}">${c.university}</div>
      <div style="font-size:0.75rem;color:var(--text-primary);font-weight:600;margin-top:4px; ${isPending ? 'opacity:0.7;' : ''}">${c.position || 'Representative'}</div>
      
      ${votingState.hasVoted
        ? `<div style="margin-top:var(--space-3);padding-top:var(--space-3);border-top:1px solid var(--light-200);">
            <div style="font-family:var(--font-display);font-size:1.4rem;font-weight:800;color:var(--epsa-green);">${c.vote_count || 0}</div>
            <div style="font-size:0.7rem;color:var(--text-muted);text-transform:uppercase;">Votes</div>
            ${isMyChoice ? `<div style="font-size:0.75rem;font-weight:700;color:var(--epsa-gold);margin-top:4px;">Your Choice</div>` : ''}
            <button class="btn btn-ghost btn-sm" style="margin-top:8px;font-size:0.75rem;" onclick="openCandidateModal(${c.id}, event)">View Profile</button>
           </div>`
        : `<div style="display:flex;gap:8px;margin-top:var(--space-3);">
            ${!votingState.compareMode ? `<button class="btn btn-outline-green btn-sm" style="flex:1;" onclick="openCandidateModal(${c.id}, event)">View Profile</button>` : ''}
            ${(!votingState.compareMode && !isPending && !isMe) ? `<button class="btn btn-primary btn-sm" style="flex:1;" onclick="selectCandidate(${c.user_id},'${c.name.replace(/'/g,"\\'")}')">Select</button>` : ''}
            ${(!votingState.compareMode && isMe && !isPending) ? `<button class="btn btn-primary btn-sm" style="flex:1;" onclick="selectCandidate(${c.user_id},'${c.name.replace(/'/g,"\\'")}')" disabled title="You cannot vote for yourself">Select</button>` : ''}
           </div>`}
    </div>`
  }).join('');
}

function openCandidateModal(id, e) {
  if (e) e.stopPropagation();
  const c = votingState.nominees.find(x => x.id === id);
  if (!c) return;
  
  votingState.selectedCandidate = {id: c.user_id, name: c.name}; // We vote by user_id
  
  const initials = c.name.split(' ').map(n=>n[0]).join('').substring(0,2).toUpperCase();
  document.getElementById('cbName').textContent = c.name;
  document.getElementById('cbUni').textContent = c.university;
  document.getElementById('cbMeta').textContent = `${c.academic_year || ''} · ${c.program_type || ''}`;
  document.getElementById('cbVotes').textContent = c.vote_count;
  
  const imgEL = document.getElementById('cbImg');
  if (c.profile_photo) { imgEL.src = API.toAbsoluteUrl(c.profile_photo.startsWith('/') ? c.profile_photo : `/${c.profile_photo}`); imgEL.style.display = 'block'; }
  else { imgEL.style.display = 'none'; } // Can add text initials fallback later

  document.getElementById('cbStatement').textContent = c.statement || 'No statement provided.';
  document.getElementById('cbVision').textContent = c.vision || 'No vision provided.';
  
  const vidBtn = document.getElementById('cbVideoBtn');
  if (c.video_url) { vidBtn.href = c.video_url; vidBtn.style.display = 'flex'; }
  else { vidBtn.style.display = 'none'; }
  
  const pdfBtn = document.getElementById('cbManifestoBtn');
  if (c.manifesto_path) { pdfBtn.href = API.resolveUploadUrl('manifestos', c.manifesto_path); pdfBtn.style.display = 'flex'; }
  else { pdfBtn.style.display = 'none'; }

  const voteBtn = document.getElementById('cbVoteBtn');
  if (votingState.hasVoted) {
    voteBtn.style.display = 'none';
  } else {
    voteBtn.style.display = 'block';
  }

  document.getElementById('candidateBioModal').classList.add('active');
}
window.openCandidateModal = openCandidateModal;

function selectCandidateFromModal() {
  document.getElementById('candidateBioModal').classList.remove('active');
  selectCandidate(votingState.selectedCandidate.id, votingState.selectedCandidate.name);
}
window.selectCandidateFromModal = selectCandidateFromModal;

function selectCandidate(userId, name) {
  if (votingState.hasVoted) { showToast('You have already cast your vote','error'); return; }
  votingState.selectedCandidate = { id: userId, name };
  document.querySelectorAll('.candidate-card').forEach(card => card.classList.remove('selected'));
  
  const confirmArea = document.getElementById('voteConfirmArea');
  const nameEl = document.getElementById('selectedCandidateName');
  if (confirmArea) confirmArea.style.display = 'block';
  if (nameEl) nameEl.textContent = name;
  
  // Scroll to confirm area
  confirmArea.scrollIntoView({behavior: 'smooth', block: 'center'});
}
window.selectCandidate = selectCandidate;

function cancelVote() {
  votingState.selectedCandidate = null;
  const confirmArea = document.getElementById('voteConfirmArea');
  if (confirmArea) confirmArea.style.display = 'none';
}
window.cancelVote = cancelVote;

async function castVote() {
  if (!votingState.selectedCandidate) { showToast('Please select a candidate first','error'); return; }
  try {
    const res = await API.castVote(votingState.selectedCandidate.id);
    votingState.hasVoted = true;
    const confirmArea = document.getElementById('voteConfirmArea');
    if (confirmArea) confirmArea.style.display = 'none';
    showToast(`🗳️ Vote cast for ${votingState.selectedCandidate.name}!`, 'success');
    await loadVoting(); // Refresh with counts and lock
  } catch(err) {
    showToast(err.message || 'Failed to cast vote', 'error');
  }
}
window.castVote = castVote;

async function submitNomination() {
  const bio = document.getElementById('nomBio').value.trim();
  const statement = document.getElementById('nomStatement').value.trim();
  const vision = document.getElementById('nomVision').value.trim();
  const videoUrl = document.getElementById('nomVideoUrl').value.trim();
  const manifesto = document.getElementById('nomManifesto').files[0];
  
  if (!bio || !statement) {
    showToast('Bio and Statement are required', 'error');
    return;
  }
  
  const fd = new FormData();
  fd.append('bio', bio);
  fd.append('statement', statement);
  fd.append('vision', vision);
  fd.append('video_url', videoUrl);
  fd.append('phase', votingState.phase?.phase_number || 1);
  if (manifesto) fd.append('manifesto', manifesto);

  try {
    const btn = document.getElementById('submitNomBtn');
    btn.textContent = 'Submitting...'; btn.disabled = true;
    await API.request('/voting/nominate', { method: 'POST', body: fd });
    showToast('✅ Nomination submitted! Awaiting review.', 'success');
    document.getElementById('nominateModal').classList.remove('active');
    const bBtn = document.getElementById('nominateBtn');
    if (bBtn) { bBtn.textContent = '✓ Nominated'; bBtn.disabled = true; bBtn.classList.remove('btn-gold'); bBtn.classList.add('btn-ghost'); }
  } catch(err) {
    showToast(err.message, 'error');
  } finally {
    document.getElementById('submitNomBtn').textContent = 'Submit Nomination';
    document.getElementById('submitNomBtn').disabled = false;
  }
}
window.submitNomination = submitNomination;

function toggleCompareMode() {
  votingState.compareMode = !votingState.compareMode;
  votingState.compareIds = [];
  const btn = document.getElementById('compareBtn');
  btn.textContent = votingState.compareMode ? 'Done Comparing' : '⚖️ Compare';
  if (votingState.compareMode) {
    btn.classList.add('btn-gold');
    btn.classList.remove('btn-ghost');
  } else {
    btn.classList.remove('btn-gold');
    btn.classList.add('btn-ghost');
  }
  renderCandidates(votingState.nominees);
}
window.toggleCompareMode = toggleCompareMode;

function toggleCompareCandidate(id) {
  if (votingState.compareIds.includes(id)) {
    votingState.compareIds = votingState.compareIds.filter(x => x !== id);
  } else {
    if (votingState.compareIds.length >= 2) {
       showToast('You can only compare 2 candidates at a time','error');
       return;
    }
    votingState.compareIds.push(id);
  }
  renderCandidates(votingState.nominees);
  
  if (votingState.compareIds.length === 2) {
     const c1 = votingState.nominees.find(x => x.id === votingState.compareIds[0]);
     const c2 = votingState.nominees.find(x => x.id === votingState.compareIds[1]);
     
     const compareGrid = document.getElementById('compareGrid');
     if (compareGrid) {
        const renderC = (c) => `
          <div style="background:var(--light-100); border-radius:var(--radius-lg); padding:var(--space-6); border:1px solid var(--light-200);">
            <div style="text-align:center; margin-bottom:var(--space-5);">
               <div style="width:80px;height:80px;border-radius:50%;background:linear-gradient(135deg,var(--epsa-green),var(--epsa-gold));display:flex;align-items:center;justify-content:center;color:white;font-weight:800;font-size:1.3rem;margin:0 auto var(--space-3); overflow:hidden; border:3px solid white; box-shadow:var(--shadow-sm);">
${c.profile_photo ? `<img src="${API.toAbsoluteUrl(c.profile_photo.startsWith('/') ? c.profile_photo : `/${c.profile_photo}`)}" style="width:100%;height:100%;object-fit:cover;">` : c.name.split(' ').map(n=>n[0]).join('').substring(0,2).toUpperCase()}
               </div>
               <div style="font-family:var(--font-display);font-weight:800;font-size:1.2rem;color:var(--text-primary);">${c.name}</div>
               <div style="font-size:0.875rem;color:var(--text-secondary);font-weight:600;">${c.university}</div>
               <div style="font-size:0.75rem;color:var(--text-muted);margin-top:4px;">${c.academic_year || ''} ${c.program_type || ''}</div>
            </div>
            
            <div style="margin-bottom:var(--space-5);">
              <h5 style="font-weight:700;color:var(--text-primary);margin-bottom:var(--space-2);font-size:0.9rem;">🎯 Personal Statement</h5>
              <p style="font-size:0.85rem;color:var(--text-secondary);line-height:1.5;">${c.statement || 'No statement provided.'}</p>
            </div>
            
            <div style="margin-bottom:var(--space-5);">
              <h5 style="font-weight:700;color:var(--text-primary);margin-bottom:var(--space-2);font-size:0.9rem;">🚀 Vision & Goals</h5>
              <p style="font-size:0.85rem;color:var(--text-secondary);line-height:1.5;">${c.vision || 'No vision provided.'}</p>
            </div>
            
            <div style="display:flex;gap:var(--space-3);margin-top:var(--space-6);padding-top:var(--space-4);border-top:1px solid var(--light-200);">
               <button class="btn btn-outline-green btn-sm" style="flex:1;" onclick="openCandidateModal(${c.id})">Full Profile</button>
               ${!votingState.hasVoted ? `<button class="btn btn-primary btn-sm" style="flex:1;" onclick="document.getElementById('compareModal').classList.remove('active'); selectCandidate(${c.user_id}, '${c.name.replace(/'/g,"\\'")}')">Vote for ${c.name.split(' ')[0]}</button>` : ''}
            </div>
          </div>
        `;
        compareGrid.innerHTML = renderC(c1) + renderC(c2);
        document.getElementById('compareModal').classList.add('active');
     } else {
        showToast('Wait for full page load', 'error');
     }
     
     toggleCompareMode(); // reset comparison state after showing modal
  }
}
window.toggleCompareCandidate = toggleCompareCandidate;

let countdownInterval = null;
function startVotingCountdown(isoDate) {
  const el = document.getElementById('votingCountdown'); if (!el) return;
  if (countdownInterval) clearInterval(countdownInterval);
  if (!isoDate) { el.textContent = 'NO DEADLINE'; return; }
  
  const end = new Date(isoDate);
  const tick = () => {
    const now  = new Date();
    const diff = end - now;
    if (diff <= 0) { el.textContent = 'PHASE CLOSED'; return; }
    const d  = Math.floor(diff / 86400000);
    const h  = Math.floor((diff % 86400000) / 3600000);
    const m  = Math.floor((diff % 3600000)  / 60000);
    el.textContent = `${d}d ${h}h ${m}m`;
  };
  tick();
  countdownInterval = setInterval(tick, 60000);
}
