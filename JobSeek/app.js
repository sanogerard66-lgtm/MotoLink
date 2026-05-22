function showScreen(id) {
  document.querySelectorAll('.screen').forEach(screen => {
    screen.classList.remove('active');
  });
  
  function showNotification(message) {
  const bar = document.getElementById('notification-bar');
  bar.textContent = message;
  bar.style.display = 'block';
  setTimeout(() => {
    bar.style.display = 'none';
  }, 3000);
}

showNotification("Mentor replied to your message!");

showNotification("Challenge completed! Badge unlocked!");

showNotification("Job posted successfully!");


showNotification("CV saved successfully!");

function loadAdminDashboard() {
  // Jobs
  const jobs = JSON.parse(localStorage.getItem('jobs')) || [];
  const jobList = document.getElementById('admin-job-list');
  jobList.innerHTML = '';
  jobs.forEach((job, index) => {
    const card = document.createElement('div');
    card.className = 'job-card';
    card.innerHTML = `
      <h4>${job.title}</h4>
      <p>${job.company} - ${job.location}</p>
      <button onclick="deleteJob(${index})">Delete</button>
    `;
    jobList.appendChild(card);
  });

  // Challenges
  const challenges = JSON.parse(localStorage.getItem('careerChallenges')) || [];
  const challengeList = document.getElementById('admin-challenge-list');
  challengeList.innerHTML = '';
  challenges.forEach((ch, index) => {
    const item = document.createElement('div');
    item.className = 'challenge';
    item.innerHTML = `
      <span>${ch.text}</span>
      <button onclick="deleteChallenge(${index})">Delete</button>
    `;
    challengeList.appendChild(item);
  });

  // Users (placeholder for now)
  const userList = document.getElementById('admin-user-list');
  userList.innerHTML = '<p>Feature coming soon: user management</p>';
}

function deleteJob(index) {
  let jobs = JSON.parse(localStorage.getItem('jobs')) || [];
  jobs.splice(index, 1);
  localStorage.setItem('jobs', JSON.stringify(jobs));
  loadAdminDashboard();
}

function deleteChallenge(index) {
  let challenges = JSON.parse(localStorage.getItem('careerChallenges')) || [];
  challenges.splice(index, 1);
  localStorage.setItem('careerChallenges', JSON.stringify(challenges));
  loadAdminDashboard();
}

// Load dashboard when admin screen is shown
document.querySelector('button[onclick="showScreen(\'admin-screen\')"]').addEventListener('click', loadAdminDashboard);
  
  function showScreen(id) {
  document.querySelectorAll('.screen').forEach(screen => {
    screen.classList.remove('active');
    screen.style.display = 'none';
  });

  const target = document.getElementById(id);
  target.style.display = 'block';
  gsap.fromTo(target, 
    { opacity: 0, y: 30 }, 
    { opacity: 1, y: 0, duration: 0.6, ease: "power2.out" }
  );
}
  document.getElementById(id).classList.add('active');
}

document.getElementById('export-btn').addEventListener('click', function() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  // Load CV data
  const savedCV = JSON.parse(localStorage.getItem('graduateCV')) || {};
  doc.setFontSize(18);
  doc.text("CareerLift Rwanda - Graduate Profile", 20, 20);

  doc.setFontSize(14);
  doc.text(`Name: ${savedCV.name || ''}`, 20, 40);
  doc.text(`Degree: ${savedCV.degree || ''}`, 20, 50);
  doc.text(`University: ${savedCV.university || ''}`, 20, 60);
  doc.text("Projects/Experience:", 20, 70);
  doc.text(savedCV.projects || '', 20, 80);

  // Load challenges
  const savedChallenges = JSON.parse(localStorage.getItem('careerChallenges')) || [];
  doc.setFontSize(16);
  doc.text("Career Challenges Completed:", 20, 100);

  let y = 110;
  savedChallenges.forEach(ch => {
    if (ch.completed) {
      doc.text(`✔ ${ch.text}`, 25, y);
      y += 10;
    }
  });

  // Save PDF
  doc.save("Graduate_Profile.pdf");
});

const challenges = [{
  id: 1,
  text: "Upload your CV",
  completed: false
},
  {
    id: 2,
    text: "Apply to 3 jobs",
    completed: false
  },
  {
    id: 3,
    text: "Complete a mock interview",
    completed: false
  }];

function loadChallenges() {
  const saved = JSON.parse(localStorage.getItem('careerChallenges')) || challenges;
  const list = document.getElementById('challenge-list');
  list.innerHTML = '';

  saved.forEach(challenge => {
    const item = document.createElement('li');
    item.className = 'challenge';
    item.innerHTML = `
    <span>${challenge.text}</span>
    ${challenge.completed ? '<span class="badge">Completed</span>':
    `<button onclick="completeChallenge(${challenge.id})">Do it</button>`}
    `;
    list.appendChild(item);
  });
}

function completeChallenge(id) {
  let saved = JSON.parse(localStorage.getItem('careerChallenges')) || challenges;
  saved = saved.map(ch => ch.id === id ? {
    ...ch, completed: true
  }: ch);
  localStorage.setItem('careerChallenges', JSON.stringify(saved));
  loadChallenges();
}
const jobCards = document.querySelectorAll('.job-card');
jobCards.forEach(card => {
  gsap.from(card, {
    scrollTrigger: {
      trigger: card,
      start: "top 90%",
    },
    opacity: 0,
    y: 50,
    duration: 0.6,
    ease: "power2.out"
  });
});
// Load challenges when screen is shown
document.querySelector('button[onclick="showScreen(\'challenges-screen\')"]').addEventListener('click', loadChallenges);
// Dummy mentor replies
const mentorReplies = [
  "Hello! How can I help you prepare?",
  "Remember to highlight your projects in interviews.",
  "Networking is key — have you tried LinkedIn?",
  "Stay confident, employers value enthusiasm!"
];

document.getElementById('job-form').addEventListener('submit', function(e) {
  e.preventDefault();
  
  const title = document.getElementById('job-title').value;
  const company = document.getElementById('job-company').value;
  const location = document.getElementById('job-location').value;
  const link = document.getElementById('job-link').value;

  const newJob = { title, company, location, applyLink: link };
  
  let jobs = JSON.parse(localStorage.getItem('jobs')) || [];
  jobs.push(newJob);
  localStorage.setItem('jobs', JSON.stringify(jobs));

  alert("Job posted successfully!");
  loadEmployerJobs();
});

function loadEmployerJobs() {
  const jobs = JSON.parse(localStorage.getItem('jobs')) || [];
  const list = document.getElementById('employer-job-list');
  list.innerHTML = '';

  jobs.forEach(job => {
    const card = document.createElement('div');
    card.className = 'job-card';
    card.innerHTML = `
      <h3>${job.title}</h3>
      <p>Company: ${job.company}</p>
      <p>Location: ${job.location}</p>
      <button onclick="window.location.href='${job.applyLink}'">Apply</button>
    `;
    list.appendChild(card);
  });
}

// Load employer jobs when screen is shown
document.querySelector('button[onclick="showScreen(\'employer-screen\')"]').addEventListener('click', loadEmployerJobs);

document.getElementById('chat-form').addEventListener('submit', function(e) {
  e.preventDefault();
  const input = document.getElementById('chat-input');
  const message = input.value.trim();
  if (!message) return;

  addMessage(message, 'user');
  input.value = '';

  // Simulate mentor reply
  setTimeout(() => {
    const reply = mentorReplies[Math.floor(Math.random() * mentorReplies.length)];
    addMessage(reply, 'mentor');
  }, 1000);
});

function addMessage(text, type) {
  const chatBox = document.getElementById('chat-box');
  const msg = document.createElement('div');
  msg.className = `message ${type}`;
  msg.textContent = text;
  chatBox.appendChild(msg);
  chatBox.scrollTop = chatBox.scrollHeight;
}
// Default to hero screen
showScreen('hero-screen');

// Handle CV form
document.getElementById('cv-form').addEventListener('submit', function(e) {
  e.preventDefault();

  const name = this.querySelector('input[placeholder="Full Name"]').value;
  const degree = this.querySelector('input[placeholder="Degree"]').value;
  const university = this.querySelector('input[placeholder="University"]').value;
  const projects = this.querySelector('textarea').value;

  const cvData = {
    name,
    degree,
    university,
    projects
  };
  localStorage.setItem('graduateCV', JSON.stringify(cvData));

  alert("CV saved successfully!");
});

// Load CV if exists
window.onload = function() {
  const savedCV = localStorage.getItem('graduateCV');
  if (savedCV) {
    const cv = JSON.parse(savedCV);
    document.querySelector('input[placeholder="Full Name"]').value = cv.name;
    document.querySelector('input[placeholder="Degree"]').value = cv.degree;
    document.querySelector('input[placeholder="University"]').value = cv.university;
    document.querySelector('textarea').value = cv.projects;
  }
};

// Load jobs dynamically
async function loadJobs() {
  try {
    const response = await fetch('jobs.json');
    const jobs = await response.json();
    const jobList = document.getElementById('job-list');
    jobList.innerHTML = '';

    jobs.forEach(job => {
      const card = document.createElement('div');
      card.className = 'job-card';
      card.innerHTML = `
      <h3>${job.title}</h3>
      <p>Company: ${job.company}</p>
      <p>Location: ${job.location}</p>
      <button onclick="window.location.href='${job.applyLink}'">Apply</button>
      `;
      jobList.appendChild(card);
    });
  } catch (error) {
    console.error("Error loading jobs:", error);
  }
}

// Call when jobs screen is shown
document.querySelector('button[onclick="showScreen(\'jobs-screen\')"]').addEventListener('click', loadJobs);