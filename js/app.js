/**
 * EventGenie — Main Application
 * Orchestrates all modules: wizard flow, dashboard, chat, plan management.
 * Exposed on window.app for inline event handler access.
 */

import { EVENT_TYPES, CURRENCIES, DEFAULT_SETTINGS } from './constants.js';
import {
  savePlan, loadPlan, loadAllPlans, updatePlan, deletePlan,
  setActivePlan, getActivePlan, getActivePlanId, loadSettings, saveSettings
} from './storage.js';
import { allocateBudget, calculateSpent, calculateRemaining, getBudgetHealth, validateBudget, formatCurrency, getBudgetSuggestion } from './budget.js';
import { generateTimelineStructure, getTimelineProgress, getDaysUntilEvent, groupTasksByMonth, getOverdueTasks, subtractMonths } from './timeline.js';
import { generateBudgetBreakdown, generateVendorChecklist, generateEventIdeas, generateAIResponse } from './ai.js';
import {
  showView, showToast, showConfirmModal, showLoading, hideLoading,
  renderProgressBar, renderBudgetBars, renderVendorCard,
  renderTimelineItem, renderChatBubble, animateCounter, showAIThinking
} from './ui.js';

// ─── State ────────────────────────────────────────────────────────────────────

let _currentStep = 1;
const TOTAL_STEPS = 4;
let _settings = { ...DEFAULT_SETTINGS };

// ─── Init ─────────────────────────────────────────────────────────────────────

/**
 * Bootstraps the application on DOMContentLoaded.
 */
function initApp() {
  _settings = { ...DEFAULT_SETTINGS, ...loadSettings() };
  _setupNavigation();
  _setupWizard();
  _setupChat();
  _setupCountdown();

  // If a plan was active when the user left, return to dashboard
  const activePlan = getActivePlan();
  if (activePlan) {
    loadDashboard(activePlan.id);
    showView('dashboard');
  } else {
    showView('landing');
  }
}

// ─── Navigation ───────────────────────────────────────────────────────────────

function _setupNavigation() {
  document.querySelectorAll('[data-nav]').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const viewId = link.dataset.nav;
      if (viewId === 'plans') renderSavedPlans();
      showView(viewId);
    });
  });

  // Landing CTA
  document.getElementById('btn-start-planning')?.addEventListener('click', () => {
    _resetWizard();
    showView('wizard');
  });

  // Dashboard: new plan
  document.getElementById('btn-new-plan')?.addEventListener('click', () => {
    _resetWizard();
    showView('wizard');
  });
}

// ─── Wizard ───────────────────────────────────────────────────────────────────

function _setupWizard() {
  // Event type cards
  document.querySelectorAll('.event-type-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.event-type-card').forEach(c => c.classList.remove('event-type-card--selected'));
      card.classList.add('event-type-card--selected');
      document.getElementById('field-event-type').value = card.dataset.type;
      _updateWizardNav();
    });
    // Keyboard support
    card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') card.click(); });
  });

  // Budget slider sync
  const slider = document.getElementById('budget-slider');
  const input  = document.getElementById('field-budget');
  if (slider && input) {
    slider.addEventListener('input', () => { input.value = slider.value; _updateBudgetPreview(); });
    input.addEventListener('input', () => {
      slider.value = Math.min(Math.max(input.value, slider.min), slider.max);
      _updateBudgetPreview();
    });
  }

  // Step nav
  document.getElementById('btn-next')?.addEventListener('click', () => nextStep());
  document.getElementById('btn-prev')?.addEventListener('click', () => prevStep());
  document.getElementById('btn-generate')?.addEventListener('click', () => submitWizard());
}

function _resetWizard() {
  _currentStep = 1;
  document.getElementById('wizard-form')?.reset();
  document.querySelectorAll('.event-type-card').forEach(c => c.classList.remove('event-type-card--selected'));
  _renderStep(1);
}

/**
 * Advances to the next wizard step after validation.
 */
export function nextStep() {
  const errors = validateStep(_currentStep);
  if (errors.length > 0) {
    showToast(errors[0], 'error');
    return;
  }
  if (_currentStep < TOTAL_STEPS) {
    _currentStep++;
    _renderStep(_currentStep);
  }
}

/**
 * Goes back to the previous wizard step.
 */
export function prevStep() {
  if (_currentStep > 1) {
    _currentStep--;
    _renderStep(_currentStep);
  }
}

/**
 * Validates the current wizard step fields.
 * @param {number} step
 * @returns {string[]} Array of error messages
 */
export function validateStep(step) {
  const errors = [];
  if (step === 1) {
    if (!document.getElementById('field-event-type')?.value) {
      errors.push('Please select an event type to continue.');
    }
  }
  if (step === 2) {
    if (!document.getElementById('field-event-name')?.value?.trim()) {
      errors.push('Please enter your event name.');
    }
    const date = document.getElementById('field-event-date')?.value;
    if (!date) {
      errors.push('Please select your event date.');
    } else if (new Date(date) <= new Date()) {
      errors.push('Event date must be in the future.');
    }
    const guests = parseInt(document.getElementById('field-guest-count')?.value);
    if (!guests || guests < 1) {
      errors.push('Please enter at least 1 guest.');
    }
  }
  if (step === 3) {
    const budget = parseFloat(document.getElementById('field-budget')?.value);
    if (!budget || budget <= 0) {
      errors.push('Please enter a valid budget amount.');
    }
  }
  return errors;
}

function _renderStep(step) {
  for (let i = 1; i <= TOTAL_STEPS; i++) {
    const el = document.getElementById(`wizard-step-${i}`);
    if (el) {
      el.hidden = i !== step;
      el.setAttribute('aria-hidden', i !== step ? 'true' : 'false');
    }
  }

  // Update step indicator
  document.querySelectorAll('.step-indicator__dot').forEach((dot, i) => {
    dot.classList.toggle('step-indicator__dot--active', i + 1 === step);
    dot.classList.toggle('step-indicator__dot--done',   i + 1 < step);
  });

  // Show/hide nav buttons
  document.getElementById('btn-prev')?.toggleAttribute('hidden', step === 1);
  document.getElementById('btn-next')?.toggleAttribute('hidden', step === TOTAL_STEPS);
  document.getElementById('btn-generate')?.toggleAttribute('hidden', step !== TOTAL_STEPS);

  // Update step counter text
  const counter = document.getElementById('step-counter');
  if (counter) counter.textContent = `Step ${step} of ${TOTAL_STEPS}`;
}

function _updateWizardNav() {
  // Highlight the next button when valid
  const nextBtn = document.getElementById('btn-next');
  if (nextBtn) nextBtn.disabled = validateStep(_currentStep).length > 0;
}

function _updateBudgetPreview() {
  const budget    = parseFloat(document.getElementById('field-budget')?.value) || 0;
  const guests    = parseInt(document.getElementById('field-guest-count')?.value) || 1;
  const eventType = document.getElementById('field-event-type')?.value;
  const currency  = document.getElementById('field-currency')?.value || 'INR';
  const preview   = document.getElementById('budget-preview');
  if (preview && eventType) {
    preview.textContent = getBudgetSuggestion(budget, guests, eventType, currency);
  }
}

// ─── Plan Generation ──────────────────────────────────────────────────────────

/**
 * Collects wizard form data and triggers full AI plan generation.
 */
export async function submitWizard() {
  const errors = [...validateStep(1), ...validateStep(2), ...validateStep(3)];
  if (errors.length > 0) { showToast(errors[0], 'error'); return; }

  const eventData = {
    eventType:   document.getElementById('field-event-type').value,
    eventName:   document.getElementById('field-event-name').value.trim(),
    eventDate:   document.getElementById('field-event-date').value,
    guestCount:  parseInt(document.getElementById('field-guest-count').value),
    venue:       document.getElementById('field-venue')?.value?.trim() || '',
    totalBudget: parseFloat(document.getElementById('field-budget').value),
    currency:    document.getElementById('field-currency')?.value || 'INR',
    preferences: document.getElementById('field-preferences')?.value?.trim() || ''
  };

  await generateFullPlan(eventData);
}

/**
 * Orchestrates all AI generation calls and saves the resulting plan.
 * @param {Object} eventData - Form data from wizard
 */
export async function generateFullPlan(eventData) {
  showView('generating');
  const steps = ['budget', 'vendors', 'ideas'];
  let stepsDone = 0;

  const updateProgress = () => {
    stepsDone++;
    renderProgressBar(Math.round((stepsDone / steps.length) * 100), 'gen-progress-bar');
    const labels = ['Calculating budget...', 'Building vendor list...', 'Generating ideas...', 'Saving your plan...'];
    const el = document.getElementById('gen-status-text');
    if (el) el.textContent = labels[stepsDone] || 'Almost done...';
  };

  try {
    const { eventType, totalBudget, guestCount, venue, preferences, currency } = eventData;

    // Step 1: Budget breakdown
    let budgetBreakdown;
    try {
      budgetBreakdown = await generateBudgetBreakdown(eventType, totalBudget, guestCount, preferences, currency);
    } catch {
      budgetBreakdown = allocateBudget(totalBudget, eventType);
    }
    updateProgress();

    // Step 2: Vendor checklist
    let vendors;
    try {
      vendors = await generateVendorChecklist(eventType, totalBudget, guestCount, venue, preferences, currency);
      vendors = Array.isArray(vendors) ? vendors.map((v, i) => ({ ...v, id: `vendor_${Date.now()}_${i}`, booked: false })) : [];
    } catch {
      vendors = EVENT_TYPES[eventType].vendors.map((name, i) => ({
        id: `vendor_${Date.now()}_${i}`, name, category: name,
        estimated: Math.round((budgetBreakdown[Object.keys(budgetBreakdown)[i]] || 0)),
        notes: '', priority: i < 3 ? 'high' : 'medium', booked: false
      }));
    }
    updateProgress();

    // Step 3: Event ideas
    let ideas = { themes: [], decor: [], catering: [], entertainment: [] };
    try {
      ideas = await generateEventIdeas(eventType, preferences, totalBudget, guestCount, currency);
    } catch { /* use empty defaults */ }
    updateProgress();

    // Step 4: Timeline (no AI call needed — deterministic)
    const timeline = generateTimelineStructure(eventData.eventDate, eventType);

    // Save plan
    const plan = savePlan({
      ...eventData, budgetBreakdown, vendors, timeline, ideas, chatHistory: []
    });

    setActivePlan(plan.id);
    showToast('Your event plan is ready! 🎉', 'success');
    loadDashboard(plan.id);
    showView('dashboard');

  } catch (err) {
    console.error('Plan generation failed:', err);
    showToast('Something went wrong. Please try again.', 'error');
    showView('wizard');
  }
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

/**
 * Loads and renders the full dashboard for a plan.
 * @param {string} planId
 */
export function loadDashboard(planId) {
  const plan = loadPlan(planId);
  if (!plan) { showToast('Plan not found.', 'error'); return; }

  setActivePlan(planId);
  const currency = plan.currency || 'INR';

  // Header
  _setText('dashboard-event-name', plan.eventName);
  _setText('dashboard-event-type', `${EVENT_TYPES[plan.eventType]?.icon} ${EVENT_TYPES[plan.eventType]?.label}`);

  // Countdown
  const days = getDaysUntilEvent(plan.eventDate);
  _setText('dashboard-countdown',
    days > 0 ? `${days} days to go! 🎉`
             : days === 0 ? 'Today is the day! 🎊'
             : `Happened ${Math.abs(days)} days ago`
  );

  // Budget overview
  const spent     = calculateSpent(plan.vendors || []);
  const remaining = calculateRemaining(plan.totalBudget, plan.vendors || []);
  const health    = getBudgetHealth(spent, plan.totalBudget);

  animateCounter(0, plan.totalBudget, 'stat-total-budget', 1000, v => formatCurrency(v, currency));
  animateCounter(0, spent,            'stat-spent',        1000, v => formatCurrency(v, currency));
  animateCounter(0, remaining,        'stat-remaining',    1000, v => formatCurrency(v, currency));
  animateCounter(0, plan.guestCount,  'stat-guests',       800);

  const healthEl = document.getElementById('budget-health-badge');
  if (healthEl) {
    healthEl.textContent = health.status === 'over' ? '⚠️ Over Budget'
                         : health.status === 'warning' ? '⚡ Watch Budget' : '✅ On Track';
    healthEl.className = `badge badge--health-${health.status}`;
  }
  renderProgressBar(health.percentage, 'budget-progress-bar', `Budget used: ${health.percentage}%`);

  // Budget breakdown bars
  if (plan.budgetBreakdown) {
    renderBudgetBars(plan.budgetBreakdown, plan.totalBudget, 'budget-breakdown-container', currency);
  }

  // Vendors
  renderVendors(plan);

  // Timeline
  renderTimeline(plan);

  // Ideas
  renderIdeas(plan);

  // Set up tab switching
  _setupDashboardTabs();
}

function _setupDashboardTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => {
        b.classList.remove('tab-btn--active');
        b.setAttribute('aria-selected', 'false');
      });
      document.querySelectorAll('.tab-panel').forEach(p => {
        p.hidden = true;
        p.setAttribute('aria-hidden', 'true');
      });
      btn.classList.add('tab-btn--active');
      btn.setAttribute('aria-selected', 'true');
      const target = document.getElementById(`tab-${btn.dataset.tab}`);
      if (target) { target.hidden = false; target.setAttribute('aria-hidden', 'false'); }
    });
  });
}

// ─── Vendors ──────────────────────────────────────────────────────────────────

export function renderVendors(plan) {
  const currency  = plan.currency || 'INR';
  const container = document.getElementById('vendors-container');
  if (!container) return;

  if (!plan.vendors?.length) {
    container.innerHTML = '<p class="empty-state">No vendors added yet.</p>';
    return;
  }
  container.innerHTML = plan.vendors.map(v => renderVendorCard(v, currency)).join('');

  // Update total estimate
  const total = calculateSpent(plan.vendors);
  _setText('vendors-total', formatCurrency(total, currency));
}

export function toggleVendorBooked(vendorId) {
  const plan = getActivePlan();
  if (!plan) return;
  const vendor = plan.vendors?.find(v => v.id === vendorId);
  if (!vendor) return;
  vendor.booked = !vendor.booked;
  updatePlan(plan.id, { vendors: plan.vendors });
  renderVendors(plan);
  showToast(vendor.booked ? 'Vendor marked as booked! ✅' : 'Vendor marked as pending.', 'info');
}

export function deleteVendor(vendorId) {
  const plan = getActivePlan();
  if (!plan) return;
  plan.vendors = plan.vendors.filter(v => v.id !== vendorId);
  updatePlan(plan.id, { vendors: plan.vendors });
  renderVendors(plan);
  showToast('Vendor removed.', 'info');
}

export function addVendor() {
  const name      = document.getElementById('new-vendor-name')?.value?.trim();
  const estimated = parseFloat(document.getElementById('new-vendor-cost')?.value);
  const priority  = document.getElementById('new-vendor-priority')?.value || 'medium';
  const notes     = document.getElementById('new-vendor-notes')?.value?.trim() || '';

  if (!name) { showToast('Please enter a vendor name.', 'error'); return; }
  if (!estimated || estimated < 0) { showToast('Please enter a valid cost.', 'error'); return; }

  const plan = getActivePlan();
  if (!plan) return;

  const newVendor = {
    id: `vendor_${Date.now()}`, name, category: name, estimated, priority, notes, booked: false
  };
  plan.vendors = [...(plan.vendors || []), newVendor];
  updatePlan(plan.id, { vendors: plan.vendors });
  renderVendors(plan);
  document.getElementById('add-vendor-form')?.reset();
  showToast('Vendor added! 🎉', 'success');
}

// ─── Timeline ─────────────────────────────────────────────────────────────────

export function renderTimeline(plan) {
  const container = document.getElementById('timeline-container');
  if (!container) return;

  const tasks     = plan.timeline || [];
  const overdue   = getOverdueTasks(tasks).map(t => t.id);
  const grouped   = groupTasksByMonth(tasks);
  const progress  = getTimelineProgress(tasks);

  renderProgressBar(progress.percentage, 'timeline-progress-bar',
    `Timeline: ${progress.done} of ${progress.total} tasks done`);
  _setText('timeline-progress-label', `${progress.done} / ${progress.total} tasks completed`);

  container.innerHTML = Object.entries(grouped).map(([month, monthTasks]) => `
    <div class="timeline-month">
      <h3 class="timeline-month__label">${month}</h3>
      <div class="timeline-month__tasks">
        ${monthTasks.map(t => renderTimelineItem(t, overdue.includes(t.id))).join('')}
      </div>
    </div>
  `).join('');
}

export function toggleTaskDone(taskId) {
  const plan = getActivePlan();
  if (!plan) return;
  const task = plan.timeline?.find(t => t.id === taskId);
  if (!task) return;
  task.done = !task.done;
  updatePlan(plan.id, { timeline: plan.timeline });
  renderTimeline(plan);
}

// ─── Ideas ────────────────────────────────────────────────────────────────────

export function renderIdeas(plan) {
  const ideas = plan.ideas;
  if (!ideas) return;

  const sections = [
    { key: 'themes',        label: '🎨 Themes',        id: 'ideas-themes' },
    { key: 'decor',         label: '🌸 Décor',          id: 'ideas-decor' },
    { key: 'catering',      label: '🍽️ Catering',       id: 'ideas-catering' },
    { key: 'entertainment', label: '🎵 Entertainment',  id: 'ideas-entertainment' }
  ];

  sections.forEach(({ key, label, id }) => {
    const el = document.getElementById(id);
    if (!el) return;
    const items = ideas[key] || [];
    el.innerHTML = items.length
      ? `<h3 class="ideas-section__title">${label}</h3>
         <ul class="ideas-list">${items.map(i => `<li class="ideas-list__item">💡 ${i}</li>`).join('')}</ul>`
      : '';
  });
}

export async function regenerateIdeas() {
  const plan = getActivePlan();
  if (!plan) return;
  showLoading('ideas-container', 4);
  showToast('Generating new ideas...', 'info');
  try {
    const ideas = await generateEventIdeas(
      plan.eventType, plan.preferences, plan.totalBudget, plan.guestCount, plan.currency
    );
    updatePlan(plan.id, { ideas });
    plan.ideas = ideas;
    renderIdeas(plan);
    showToast('Fresh ideas ready! ✨', 'success');
  } catch {
    showToast('Could not generate ideas. Try again.', 'error');
  } finally {
    hideLoading('ideas-container');
  }
}

// ─── AI Chat ──────────────────────────────────────────────────────────────────

function _setupChat() {
  const form  = document.getElementById('chat-form');
  const input = document.getElementById('chat-input');

  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const message = input?.value?.trim();
    if (message) { sendChatMessage(message); input.value = ''; }
  });

  // Quick question chips
  document.querySelectorAll('.chat-chip').forEach(chip => {
    chip.addEventListener('click', () => sendChatMessage(chip.textContent));
  });
}

export async function sendChatMessage(message) {
  const plan      = getActivePlan();
  const chatList  = document.getElementById('chat-messages');
  if (!chatList) return;

  // Render user bubble
  const userBubble = document.createElement('div');
  userBubble.innerHTML = renderChatBubble('user', message, new Date().toISOString());
  chatList.appendChild(userBubble.firstElementChild);

  // Show thinking indicator
  const thinking = showAIThinking();
  chatList.appendChild(thinking);
  chatList.scrollTop = chatList.scrollHeight;

  try {
    const response  = await generateAIResponse(message, plan);
    thinking.remove();

    const aiBubble = document.createElement('div');
    aiBubble.innerHTML = renderChatBubble('ai', response, new Date().toISOString());
    chatList.appendChild(aiBubble.firstElementChild);

    // Persist chat history
    if (plan) {
      const chatHistory = [...(plan.chatHistory || []),
        { role: 'user', content: message, timestamp: new Date().toISOString() },
        { role: 'ai',   content: response, timestamp: new Date().toISOString() }
      ];
      updatePlan(plan.id, { chatHistory });
    }
  } catch (err) {
    thinking.remove();
    const errBubble = document.createElement('div');
    errBubble.innerHTML = renderChatBubble('ai', 'Sorry, I had trouble connecting. Please try again. 🙏');
    chatList.appendChild(errBubble.firstElementChild);
  }

  chatList.scrollTop = chatList.scrollHeight;
}

// ─── Saved Plans ──────────────────────────────────────────────────────────────

export function renderSavedPlans() {
  const container = document.getElementById('plans-container');
  if (!container) return;

  const plans = loadAllPlans();
  if (!plans.length) {
    container.innerHTML = `
      <div class="empty-state">
        <p class="empty-state__text">No saved plans yet.</p>
        <button class="btn btn--primary" onclick="window.app.startNewPlan()">Create Your First Plan</button>
      </div>`;
    return;
  }

  container.innerHTML = plans.map(plan => {
    const type     = EVENT_TYPES[plan.eventType];
    const days     = getDaysUntilEvent(plan.eventDate);
    const progress = getTimelineProgress(plan.timeline || []);
    const currency = plan.currency || 'INR';
    const isActive = getActivePlanId() === plan.id;

    return `
      <div class="plan-card glass-card ${isActive ? 'plan-card--active' : ''}">
        <div class="plan-card__icon" aria-hidden="true">${type?.icon || '🎉'}</div>
        <div class="plan-card__body">
          <h3 class="plan-card__name">${plan.eventName}</h3>
          <p class="plan-card__meta">${type?.label} · ${plan.guestCount} guests · ${formatCurrency(plan.totalBudget, currency)}</p>
          <p class="plan-card__date">${days > 0 ? `${days} days away` : 'Past event'}</p>
          <div class="plan-card__progress">
            <div class="progress-bar" role="progressbar" aria-valuenow="${progress.percentage}" aria-valuemin="0" aria-valuemax="100">
              <div class="progress-bar__fill" style="width:${progress.percentage}%"></div>
            </div>
            <span class="plan-card__progress-label">${progress.percentage}% complete</span>
          </div>
        </div>
        <div class="plan-card__actions">
          <button class="btn btn--primary btn--sm" onclick="window.app.openPlan('${plan.id}')" aria-label="Open plan: ${plan.eventName}">Open</button>
          <button class="btn btn--ghost btn--sm"  onclick="window.app.confirmDeletePlan('${plan.id}')" aria-label="Delete plan: ${plan.eventName}">🗑️</button>
        </div>
      </div>
    `;
  }).join('');
}

export function openPlan(planId) {
  loadDashboard(planId);
  showView('dashboard');
}

export async function confirmDeletePlan(planId) {
  const plan = loadPlan(planId);
  if (!plan) return;
  const confirmed = await showConfirmModal(
    'Delete Plan',
    `Are you sure you want to delete "${plan.eventName}"? This cannot be undone.`,
    'Delete', 'Cancel'
  );
  if (confirmed) {
    deletePlan(planId);
    renderSavedPlans();
    showToast('Plan deleted.', 'info');
    if (getActivePlanId() === null) showView('landing');
  }
}

export function startNewPlan() {
  _resetWizard();
  showView('wizard');
}

// ─── Countdown Timer ──────────────────────────────────────────────────────────

function _setupCountdown() {
  // Refresh countdown every minute
  setInterval(() => {
    const plan = getActivePlan();
    if (!plan) return;
    const days = getDaysUntilEvent(plan.eventDate);
    _setText('dashboard-countdown',
      days > 0 ? `${days} days to go! 🎉`
               : days === 0 ? "Today's the day! 🎊"
               : `Happened ${Math.abs(days)} days ago`
    );
  }, 60000);
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function _setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

// ─── Expose to window (for inline handlers) ───────────────────────────────────

window.app = {
  nextStep, prevStep, validateStep, submitWizard,
  loadDashboard, toggleVendorBooked, deleteVendor, addVendor,
  renderVendors, toggleTaskDone, renderTimeline,
  regenerateIdeas, sendChatMessage,
  renderSavedPlans, openPlan, confirmDeletePlan, startNewPlan,
};

// ─── Boot ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', initApp);
