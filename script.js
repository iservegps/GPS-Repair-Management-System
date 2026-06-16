/**
 * GPS Repair Management System - Frontend Controller (script.js)
 * Designed for static hosting (GitHub Pages) with decoupled REST API architecture
 */

// CONFIGURATION: Replace this with your Google Apps Script Web App URL after deployment
var API_URL = "https://script.google.com/macros/s/AKfycbwiN2uRXOWjiHVeUTvr2tWTrjYY3_LfMhruS6ZCYLSTDvs9AdR1VKvaNEUsh1BR9KioIg/exec";

// Fallback to localStorage if not hardcoded (allows testing on the fly)
if (API_URL === "YOUR_APPS_SCRIPT_WEB_APP_URL" || !API_URL) {
  API_URL = localStorage.getItem('API_URL') || "";
}

// Global Application State
var userSession = {
  isLoggedIn: false,
  username: '',
  name: '',
  role: ''
};
var repairsCache = [];
var techsCache = [];
var settingsCache = {};
var currentActiveRepairId = '';
var monthlyTrendChart = null;

$(document).ready(function() {
  // 1. Theme Configuration
  var savedTheme = localStorage.getItem('theme') || 'light';
  document.documentElement.setAttribute('data-theme', savedTheme);
  updateThemeIcon(savedTheme);

  // 2. Pre-fill API URL config box
  if (API_URL) {
    $('#configApiUrl').val(API_URL);
  }

  // 3. Check Session from sessionStorage
  var sessionStr = sessionStorage.getItem('userSession');
  if (sessionStr) {
    userSession = JSON.parse(sessionStr);
    updateAuthUI();
  } else {
    showSection('track-page');
  }

  // 4. Set report date default selectors
  var today = new Date();
  $('#report-Month').val(today.getMonth() + 1);
  $('#report-Year').val(today.getFullYear());

  // 5. Initial Public Settings load
  if (API_URL) {
    loadPublicSettings();
  }
});

/* ==========================================================================
   REST API Communication Handler
   ========================================================================== */

/**
 * Universal AJAX fetch requester targeting the Google Apps Script API endpoint.
 * Supports CORS, follow redirects, and wraps all read/write routing switches.
 */
function callAPI(action, data, method) {
  method = method || 'POST';
  
  if (!API_URL) {
    Swal.fire({
      icon: 'warning',
      title: 'ยังไม่ได้ตั้งค่า API URL',
      text: 'กรุณากรอก Google Apps Script Web App URL บนหน้าล็อกอิน เพื่อเริ่มเชื่อมต่อฐานข้อมูล',
      confirmButtonText: 'ตกลง'
    });
    return Promise.reject(new Error("API URL is missing"));
  }
  
  var fetchOptions = {
    method: method,
    redirect: 'follow' // Vital since Apps Script uses HTTP 302 redirects
  };
  
  var url = API_URL;
  
  if (method === 'POST') {
    fetchOptions.body = JSON.stringify({
      action: action,
      data: data
    });
    // Use text/plain for CORS-safe requests to prevent preflight OPTIONS requests failing in GAS
    fetchOptions.headers = {
      'Content-Type': 'text/plain;charset=utf-8'
    };
  } else {
    // GET request mapping
    var params = new URLSearchParams(data);
    params.append('action', action);
    url = API_URL + (API_URL.indexOf('?') === -1 ? '?' : '&') + params.toString();
  }
  
  return fetch(url, fetchOptions)
    .then(function(res) {
      if (!res.ok) throw new Error("HTTP connection failed status: " + res.status);
      return res.json();
    })
    .then(function(response) {
      if (!response.success) {
        throw new Error(response.message || "เกิดข้อผิดพลาดในการดึงข้อมูล");
      }
      return response;
    });
}

/* ==========================================================================
   Theme & SPA Routing
   ========================================================================== */

function toggleTheme() {
  var currentTheme = document.documentElement.getAttribute('data-theme');
  var newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', newTheme);
  localStorage.setItem('theme', newTheme);
  updateThemeIcon(newTheme);
}

function updateThemeIcon(theme) {
  var icon = $('#theme-toggle-btn i');
  if (theme === 'dark') {
    icon.removeClass('fa-moon').addClass('fa-sun');
  } else {
    icon.removeClass('fa-sun').addClass('fa-moon');
  }
}

function showSection(sectionId) {
  // Page security guards
  if (!userSession.isLoggedIn) {
    if (sectionId !== 'track-page' && sectionId !== 'login-page') {
      showSection('track-page');
      return;
    }
  } else {
    // Role permissions guards
    if (userSession.role === 'Staff' && (sectionId === 'reports-page' || sectionId === 'settings-page')) {
      Swal.fire('ข้อจำกัดสิทธิ์', 'สิทธิ์ Staff ไม่ได้รับอนุญาตให้ดูส่วนนี้', 'warning');
      showSection('dashboard-page');
      return;
    }
    if (userSession.role === 'Technician' && (sectionId === 'add-page' || sectionId === 'reports-page' || sectionId === 'settings-page')) {
      Swal.fire('ข้อจำกัดสิทธิ์', 'สิทธิ์ช่างเทคนิคไม่ได้รับอนุญาตให้ดูส่วนนี้', 'warning');
      showSection('dashboard-page');
      return;
    }
  }

  // Toggle sections
  $('.page-section').removeClass('active');
  $('#' + sectionId).addClass('active');

  // Nav link focus
  $('.navbar-nav .nav-link').removeClass('active');
  var btnId = 'nav-' + sectionId.replace('-page', '');
  $('#' + btnId).addClass('active');

  // Trigger section loads
  if (sectionId === 'dashboard-page') {
    loadDashboardData();
  } else if (sectionId === 'manage-page') {
    loadManagePageData();
  } else if (sectionId === 'settings-page') {
    loadSettingsPageData();
  } else if (sectionId === 'add-page') {
    loadIntakePageData();
  }

  // Hide mobile navbar on navigate
  $('.navbar-collapse').collapse('hide');
}

/* ==========================================================================
   User Sessions & Configs
   ========================================================================== */

function handleLogin(event) {
  event.preventDefault();
  
  // Save API URL configuration first
  var enteredApiUrl = $('#configApiUrl').val().trim();
  if (!enteredApiUrl) {
    Swal.fire('ตั้งค่าระบุ API', 'กรุณากรอก Google Apps Script Web App URL ก่อน', 'warning');
    return;
  }
  
  API_URL = enteredApiUrl;
  localStorage.setItem('API_URL', enteredApiUrl);

  var username = $('#loginUsername').val().trim();
  var password = $('#loginPassword').val();

  Swal.fire({
    title: 'กำลังตรวจสอบสิทธิ์ช่าง...',
    allowOutsideClick: false,
    didOpen: function() { Swal.showLoading(); }
  });

  callAPI('login', { username: username, password: password })
    .then(function(response) {
      userSession.isLoggedIn = true;
      userSession.username = response.username;
      userSession.name = response.name;
      userSession.role = response.role;

      sessionStorage.setItem('userSession', JSON.stringify(userSession));
      updateAuthUI();
      
      return loadPublicSettings(); // Ensure settings are loaded on login
    })
    .then(function() {
      Swal.fire({
        icon: 'success',
        title: 'เข้าสู่ระบบสำเร็จ!',
        text: 'ยินดีต้อนรับคุณ ' + userSession.name,
        timer: 1500,
        showConfirmButton: false
      }).then(function() {
        showSection('dashboard-page');
        $('#loginForm')[0].reset();
      });
    })
    .catch(function(error) {
      Swal.fire('ข้อผิดพลาด', error.message, 'error');
    });
}

function logoutUser() {
  userSession.isLoggedIn = false;
  userSession.username = '';
  userSession.name = '';
  userSession.role = '';
  
  sessionStorage.removeItem('userSession');
  updateAuthUI();
  
  Swal.fire({
    icon: 'info',
    title: 'ออกจากระบบแล้ว',
    timer: 1200,
    showConfirmButton: false
  }).then(function() {
    showSection('track-page');
  });
}

function updateAuthUI() {
  if (userSession.isLoggedIn) {
    $('#login-nav-item').hide();
    $('#user-profile-menu').show();
    $('#user-display-name').text(userSession.name);
    $('#user-display-role').text('สิทธิ์: ' + userSession.role);
    $('#main-menu').show();
    
    if (userSession.role === 'Staff') {
      $('#nav-reports, #nav-settings').hide();
      $('.admin-only-content').hide();
    } else if (userSession.role === 'Technician') {
      $('#nav-add, #nav-reports, #nav-settings').hide();
      $('.staff-only-content').hide();
    } else {
      $('#nav-add, #nav-reports, #nav-settings').show();
      $('.admin-only-content, .staff-only-content').show();
    }
  } else {
    $('#login-nav-item').show();
    $('#user-profile-menu').hide();
    $('#main-menu').hide();
  }
}

/* ==========================================================================
   Public Track Status
   ========================================================================== */

function handlePublicTrack(event) {
  event.preventDefault();
  var query = $('#trackInput').val().trim();
  if (!query) return;

  Swal.fire({
    title: 'กำลังค้นหาประวัติชิ้นงาน...',
    allowOutsideClick: false,
    didOpen: function() { Swal.showLoading(); }
  });

  callAPI('trackStatus', { query: query }, 'GET')
    .then(function(response) {
      Swal.close();
      renderPublicTrackResult(response.data);
    })
    .catch(function(error) {
      $('#trackResultSection').hide();
      Swal.fire('ไม่พบข้อมูล', error.message, 'warning');
    });
}

function renderPublicTrackResult(item) {
  $('#res-RepairID').text(item.RepairID);
  $('#res-ReceiveDate').text(item.ReceiveDate || '-');
  
  var badgeClass = getStatusBadgeClass(item.Status);
  $('#res-StatusBadge').attr('class', 'status-badge ' + badgeClass).text(item.Status);
  
  var step = getStatusStepNumber(item.Status);
  $('.timeline-steps .timeline-step').removeClass('active completed');
  for (var i = 1; i <= 6; i++) {
    var stepEl = $('#t-step-' + i);
    if (i < step) {
      stepEl.addClass('completed');
    } else if (i === step) {
      stepEl.addClass('active');
    }
  }
  
  $('#res-Brand').text(item.Brand || '-');
  $('#res-Model').text(item.Model || '-');
  $('#res-Problem').text(item.Problem || '-');
  
  $('#res-DueDate').text(item.DueDate || '-');
  $('#res-CompleteDate').text(item.CompleteDate || '-');
  $('#res-LastUpdate').text(item.LastUpdate || '-');
  
  // Render Photo Gallery
  var photoGallery = $('#res-PhotosGallery');
  photoGallery.empty();
  var hasPhotos = false;

  var photoStages = [
    { label: 'ภาพก่อนซ่อม', url: item.ImageBefore },
    { label: 'ภาพระหว่างซ่อม', url: item.ImageDuring },
    { label: 'ภาพหลังซ่อม', url: item.ImageAfter }
  ];

  photoStages.forEach(function(stage) {
    if (stage.url) {
      hasPhotos = true;
      var fileId = getGoogleDriveFileId(stage.url);
      var thumbUrl = fileId ? 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w200' : '';
      
      var col = $('<div class="col-6 col-md-4"></div>');
      var card = $('<div class="card p-2 text-center border-0 bg-light text-dark"></div>');
      var label = $('<small class="fw-semibold text-muted mb-2 d-block"></small>').text(stage.label);
      var link = $('<a target="_blank"></a>').attr('href', stage.url);
      var img = $('<img class="img-thumbnail" style="height:100px; object-fit:cover;">');
      
      if (thumbUrl) {
        img.attr('src', thumbUrl);
      } else {
        img.attr('src', 'https://placehold.co/100x100?text=ดูรูปภาพ');
      }
      
      link.append(img);
      card.append(label).append(link);
      col.append(card);
      photoGallery.append(col);
    }
  });

  if (hasPhotos) {
    $('#res-PhotosDiv').show();
  } else {
    $('#res-PhotosDiv').hide();
  }

  $('#trackResultSection').show();
}

/* ==========================================================================
   Dashboard Renderer
   ========================================================================== */

function loadDashboardData() {
  callAPI('getDashboardStats', {}, 'GET')
    .then(function(res) {
      var stats = res.data;
      $('#dash-Total').text(stats.total);
      $('#dash-Pending').text(stats.pending);
      $('#dash-Fixing').text(stats.fixing);
      $('#dash-Finished').text(stats.finished + stats.returned);

      renderDashboardChart(stats.monthlyTrends);
    })
    .catch(function(error) {
      console.error(error);
    });
}

function renderDashboardChart(monthlyTrends) {
  var ctx = document.getElementById('monthlyTrendChart').getContext('2d');
  
  if (monthlyTrendChart) {
    monthlyTrendChart.destroy();
  }
  
  var sortedMonths = Object.keys(monthlyTrends).sort();
  var counts = sortedMonths.map(function(m) { return monthlyTrends[m]; });
  
  var thaiMonthLabels = sortedMonths.map(function(m) {
    var parts = m.split('-');
    var yearStr = (parseInt(parts[0]) + 543).toString();
    var monthNames = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    var monthStr = monthNames[parseInt(parts[1]) - 1];
    return monthStr + ' ' + yearStr.substring(2);
  });

  var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  var gridColor = isDark ? '#334155' : '#e2e8f0';
  var textColor = isDark ? '#94a3b8' : '#64748b';

  monthlyTrendChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: thaiMonthLabels,
      datasets: [{
        label: 'จำนวนงานซ่อม (เครื่อง)',
        data: counts,
        backgroundColor: '#0284c7',
        borderRadius: 8,
        borderWidth: 0,
        maxBarThickness: 45
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        y: {
          grid: { color: gridColor },
          ticks: { color: textColor, stepSize: 1 }
        },
        x: {
          grid: { display: false },
          ticks: { color: textColor }
        }
      }
    }
  });
}

function filterByStatusCounter(keyword) {
  showSection('manage-page');
  $('#filter-Status').val(keyword).trigger('change');
}

/* ==========================================================================
   Repairs Manage Table
   ========================================================================== */

function loadManagePageData() {
  reloadAllData();
}

function reloadAllData() {
  $('#repairsTable tbody').html('<tr><td colspan="8" class="text-center py-4"><div class="spinner-border text-primary" role="status"></div><br><span class="small text-muted mt-2 d-block">กำลังอ่านข้อมูลจาก Google Sheets...</span></td></tr>');
  
  callAPI('getTechnicians', {}, 'GET')
    .then(function(res) {
      techsCache = res.data;
      populateTechDropdowns(techsCache);
      
      return callAPI('getRepairs', {}, 'GET');
    })
    .then(function(res) {
      repairsCache = res.data;
      renderRepairsTable(repairsCache);
    })
    .catch(function(error) {
      Swal.fire('ข้อผิดพลาด', error.message, 'error');
    });
}

function populateTechDropdowns(techs) {
  var addSelect = $('#add-Technician-Select');
  var editSelect = $('#edit-Technician');
  var filterSelect = $('#filter-Technician');
  
  addSelect.empty().append('<option value="">-- ยังไม่ระบุช่าง --</option>');
  editSelect.empty().append('<option value="">-- ยังไม่ระบุช่าง --</option>');
  filterSelect.empty().append('<option value="">-- แสดงช่างทุกคน --</option>');
  
  techs.forEach(function(t) {
    if (t.Active === 'Yes') {
      var opt = $('<option></option>').val(t.Name).text(t.Name + ' (' + t.Role + ')');
      addSelect.append(opt.clone());
      editSelect.append(opt.clone());
      filterSelect.append($('<option></option>').val(t.Name).text(t.Name));
    }
  });
}

function renderRepairsTable(data) {
  $('#repairsTable').DataTable({
    data: data,
    destroy: true,
    order: [[1, 'desc']],
    columns: [
      { data: 'RepairID', className: 'fw-bold text-primary' },
      { data: 'ReceiveDate' },
      { 
        data: null,
        render: function(row) {
          return '<div class="fw-semibold">' + row.CustomerName + '</div><small class="text-secondary">' + row.Phone + '</small>';
        }
      },
      { 
        data: null,
        render: function(row) {
          return (row.Brand || '-') + ' / ' + (row.Model || '-');
        }
      },
      { data: 'SerialNumber' },
      { 
        data: 'Status',
        render: function(val) {
          var badgeClass = getStatusBadgeClass(val);
          return '<span class="status-badge ' + badgeClass + '">' + val + '</span>';
        }
      },
      { 
        data: 'Technician',
        render: function(val) {
          return val ? '<span class="small fw-semibold text-secondary"><i class="fa-solid fa-user-gear me-1"></i>' + val + '</span>' : '<span class="text-muted small">ยังไม่จ่ายงาน</span>';
        }
      },
      {
        data: null,
        render: function(row) {
          var detailsBtn = '<button class="btn btn-light border text-primary btn-sm me-1" onclick="openDetailsModal(\'' + row.RepairID + '\')" title="ดูรายละเอียด"><i class="fa-solid fa-eye"></i></button>';
          var editBtn = '<button class="btn btn-light border text-warning btn-sm me-1" onclick="openEditModal(\'' + row.RepairID + '\')" title="แก้ไขข้อมูล"><i class="fa-solid fa-pen-to-square"></i></button>';
          var deleteBtn = '';
          
          if (userSession.role === 'Admin') {
            deleteBtn = '<button class="btn btn-light border text-danger btn-sm" onclick="deleteRepairJob(\'' + row.RepairID + '\')" title="ลบงานซ่อม"><i class="fa-solid fa-trash"></i></button>';
          }
          
          return '<div class="btn-group">' + detailsBtn + editBtn + deleteBtn + '</div>';
        }
      }
    ],
    language: {
      url: 'https://cdn.datatables.net/plug-ins/1.13.6/i18n/th.json'
    }
  });
}

function applyFilters() {
  var table = $('#repairsTable').DataTable();
  var status = $('#filter-Status').val();
  var tech = $('#filter-Technician').val();
  
  table.column(5).search(status);
  table.column(6).search(tech);
  table.draw();
}

/* ==========================================================================
   CRUD Actions (Repairs)
   ========================================================================== */

function loadIntakePageData() {
  callAPI('getTechnicians', {}, 'GET')
    .then(function(res) {
      populateTechDropdowns(res.data);
    })
    .catch(function(error) {
      console.error(error);
    });
}

function submitIntakeForm(event) {
  event.preventDefault();
  
  var form = $('#addRepairForm')[0];
  var formData = {};
  $(form).serializeArray().forEach(function(item) {
    formData[item.name] = item.value;
  });

  Swal.fire({
    title: 'กำลังเปิดบันทึกใบสั่งซ่อม...',
    allowOutsideClick: false,
    didOpen: function() { Swal.showLoading(); }
  });

  callAPI('addRepair', formData)
    .then(function(res) {
      Swal.fire({
        icon: 'success',
        title: 'บันทึกเปิดงานซ่อมสำเร็จ!',
        html: 'ออกรหัสสั่งซ่อม: <b class="text-primary fs-4">' + res.repairID + '</b>',
        confirmButtonText: 'ตกลง'
      }).then(function() {
        form.reset();
        showSection('manage-page');
      });
    })
    .catch(function(error) {
      Swal.fire('ล้มเหลว', error.message, 'error');
    });
}

function openEditModal(repairId) {
  var item = repairsCache.find(function(r) { return r.RepairID === repairId; });
  if (!item) return;

  $('#edit-RepairID').val(item.RepairID);
  $('#edit-Status').val(item.Status);
  $('#edit-Technician').val(item.Technician || '');
  $('#edit-Price').val(item.Price || 0);
  $('#edit-PartsCost').val(item.PartsCost || 0);
  $('#edit-DueDate').val(item.DueDate || '');
  $('#edit-Problem').val(item.Problem || '');
  $('#edit-Note').val(item.Note || '');

  new bootstrap.Modal(document.getElementById('editModal')).show();
}

function submitEditForm(event) {
  event.preventDefault();
  var repairId = $('#edit-RepairID').val();
  var payload = {
    repairId: repairId,
    updateData: {
      Status: $('#edit-Status').val(),
      Technician: $('#edit-Technician').val(),
      Price: $('#edit-Price').val(),
      PartsCost: $('#edit-PartsCost').val(),
      DueDate: $('#edit-DueDate').val(),
      Problem: $('#edit-Problem').val(),
      Note: $('#edit-Note').val()
    }
  };

  Swal.fire({
    title: 'กำลังบันทึกการเปลี่ยนแปลง...',
    allowOutsideClick: false,
    didOpen: function() { Swal.showLoading(); }
  });

  callAPI('updateRepair', payload)
    .then(function() {
      bootstrap.Modal.getInstance(document.getElementById('editModal')).hide();
      Swal.fire({
        icon: 'success',
        title: 'อัปเดตเรียบร้อย',
        timer: 1500,
        showConfirmButton: false
      }).then(function() {
        reloadAllData();
      });
    })
    .catch(function(error) {
      Swal.fire('ข้อผิดพลาด', error.message, 'error');
    });
}

function deleteRepairJob(repairId) {
  Swal.fire({
    title: 'ยืนยันการลบรายการ?',
    text: 'การลบข้อมูลรหัส ' + repairId + ' จะลบถาวรในฐานข้อมูลและถังขยะของ Drive',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#ef4444',
    cancelButtonColor: '#64748b',
    confirmButtonText: 'ใช่, ฉันต้องการลบ!',
    cancelButtonText: 'ยกเลิก'
  }).then(function(result) {
    if (result.isConfirmed) {
      Swal.fire({
        title: 'กำลังลบจากคลาวด์...',
        allowOutsideClick: false,
        didOpen: function() { Swal.showLoading(); }
      });

      callAPI('deleteRepair', { repairId: repairId })
        .then(function() {
          Swal.fire('ลบเสร็จสิ้น', 'ข้อมูลสั่งซ่อมถูกทำลายแล้ว', 'success');
          reloadAllData();
        })
        .catch(function(error) {
          Swal.fire('ผิดพลาด', error.message, 'error');
        });
    }
  });
}

/* ==========================================================================
   Details Modal & Base64 Image Upload
   ========================================================================== */

function openDetailsModal(repairId) {
  var item = repairsCache.find(function(r) { return r.RepairID === repairId; });
  if (!item) return;
  currentActiveRepairId = repairId;

  $('#modalDetailTitle').text('ข้อมูลใบประวัติงานซ่อม: ' + item.RepairID);
  
  var step = getStatusStepNumber(item.Status);
  $('#modalTimeline .timeline-step').removeClass('active completed');
  for (var i = 1; i <= 6; i++) {
    var stepEl = $('#m-step-' + i);
    if (i < step) {
      stepEl.addClass('completed');
    } else if (i === step) {
      stepEl.addClass('active');
    }
  }

  // Populate data
  $('#det-CustomerName').text(item.CustomerName || '-');
  $('#det-Phone').text(item.Phone || '-');
  $('#det-Email').text(item.Email || '-');
  $('#det-Address').text(item.Address || '-');

  $('#det-BrandModel').text((item.Brand || '-') + ' / ' + (item.Model || '-'));
  $('#det-SerialNumber').text(item.SerialNumber || '-');
  $('#det-IMEI').text(item.IMEI || '-');
  $('#det-Accessories').text(item.Accessories || '-');

  $('#det-Problem').text(item.Problem || '-');
  $('#det-Note').text(item.Note || '-');
  $('#det-Technician').text(item.Technician || 'ยังไม่มีการระบุผู้รับงาน');
  $('#det-ReceiveDate').text(item.ReceiveDate || '-');
  $('#det-DueDate').text(item.DueDate || '-');
  $('#det-CompleteDate').text(item.CompleteDate || '-');

  // Financial info
  var priceVal = parseFloat(item.Price || 0);
  var costVal = parseFloat(item.PartsCost || 0);
  $('#det-Price').text(priceVal.toLocaleString('th-TH', {minimumFractionDigits: 2}));
  $('#det-PartsCost').text(costVal.toLocaleString('th-TH', {minimumFractionDigits: 2}));
  $('#det-Profit').text((priceVal - costVal).toLocaleString('th-TH', {minimumFractionDigits: 2}));

  // Render Image Previews
  setupDetailsImagePreview('Before', item.ImageBefore);
  setupDetailsImagePreview('During', item.ImageDuring);
  setupDetailsImagePreview('After', item.ImageAfter);

  new bootstrap.Modal(document.getElementById('detailsModal')).show();
}

function setupDetailsImagePreview(type, url) {
  var previewDiv = $('#div-Preview-' + type);
  var uploadBox = $('#upload-box-' + type);
  
  if (url) {
    var fileId = getGoogleDriveFileId(url);
    var thumbUrl = fileId ? 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w200' : '';
    
    previewDiv.empty().show();
    var container = $('<div class="preview-image-container"></div>');
    var link = $('<a target="_blank"></a>').attr('href', url);
    var img = $('<img class="img-thumbnail">');
    
    if (thumbUrl) {
      img.attr('src', thumbUrl);
    } else {
      img.attr('src', 'https://placehold.co/120x120?text=View+Image');
    }
    
    var changeBtn = $('<button class="btn btn-sm btn-dark position-absolute bottom-0 start-50 translate-middle-x mb-1 rounded-pill opacity-75" style="font-size:10px;"><i class="fa-solid fa-arrows-rotate me-1"></i>เปลี่ยนรูป</button>');
    changeBtn.click(function(e) {
      e.preventDefault();
      e.stopPropagation();
      triggerFileInput(type);
    });

    link.append(img);
    container.append(link).append(changeBtn);
    previewDiv.append(container);
    
    uploadBox.hide();
  } else {
    previewDiv.empty().hide();
    uploadBox.show();
  }
}

function triggerFileInput(type) {
  var element = document.getElementById('fileInput-' + type);
  if (element) {
    element.click();
  }
}

function handleImageFileSelect(input, type) {
  var file = input.files[0];
  if (!file) return;

  if (file.size > 5 * 1024 * 1024) {
    Swal.fire('ไฟล์ขนาดใหญ่เกินไป', 'ขนาดภาพถ่ายต้องไม่เกิน 5MB', 'warning');
    input.value = '';
    return;
  }

  Swal.fire({
    title: 'กำลังบีบอัดและอัปโหลดภาพ...',
    text: 'บันทึกรูปเข้า Google Drive กรุณารอสักครู่',
    allowOutsideClick: false,
    didOpen: function() { Swal.showLoading(); }
  });

  var reader = new FileReader();
  reader.onload = function(e) {
    var base64Data = e.target.result;
    
    var payload = {
      repairId: currentActiveRepairId,
      imageType: type,
      base64Data: base64Data,
      filename: file.name
    };

    callAPI('uploadImage', payload)
      .then(function(res) {
        Swal.fire('อัปโหลดเสร็จสิ้น!', 'ภาพประวัติถูกบันทึกสำเร็จ', 'success');
        input.value = '';
        setupDetailsImagePreview(type, res.url);
        reloadAllData();
      })
      .catch(function(error) {
        Swal.fire('อัปโหลดล้มเหลว', error.message, 'error');
        input.value = '';
      });
  };
  reader.readAsDataURL(file);
}

/* ==========================================================================
   Report Summary & PDF/Excel Exports
   ========================================================================== */

function toggleReportSelectors() {
  var type = $('#report-Type').val();
  if (type === 'daily') {
    $('.report-monthly-selector, .report-yearly-selector').hide();
  } else if (type === 'monthly') {
    $('.report-monthly-selector, .report-yearly-selector').show();
  } else if (type === 'yearly') {
    $('.report-monthly-selector').hide();
    $('.report-yearly-selector').show();
  }
}

function generateReport(event) {
  event.preventDefault();
  var type = $('#report-Type').val();
  var month = $('#report-Month').val();
  var year = $('#report-Year').val();

  Swal.fire({
    title: 'กำลังรวบรวมรายงาน...',
    allowOutsideClick: false,
    didOpen: function() { Swal.showLoading(); }
  });

  var queryParams = {
    type: type,
    year: year,
    month: month
  };

  callAPI('getReports', queryParams, 'GET')
    .then(function(res) {
      Swal.close();
      renderReportResults(res.data);
    })
    .catch(function(error) {
      Swal.fire('ข้อผิดพลาด', error.message, 'error');
    });
}

function renderReportResults(res) {
  $('#repSummary-Count').text(res.summary.totalJobs + ' เครื่อง');
  $('#repSummary-Revenue').text('฿' + res.summary.totalRevenue.toLocaleString('th-TH', {minimumFractionDigits:2}));
  $('#repSummary-Cost').text('฿' + res.summary.totalCost.toLocaleString('th-TH', {minimumFractionDigits:2}));
  $('#repSummary-Profit').text('฿' + res.summary.totalProfit.toLocaleString('th-TH', {minimumFractionDigits:2}));
  
  var tbody = $('#reportsTable tbody');
  tbody.empty();
  
  if (res.items.length === 0) {
    tbody.append('<tr><td colspan="9" class="text-center py-3 text-muted">ไม่พบประวัติงานในช่วงเวลาที่ระบุ</td></tr>');
  } else {
    res.items.forEach(function(r) {
      var price = parseFloat(r.Price || 0);
      var cost = parseFloat(r.PartsCost || 0);
      var profit = price - cost;
      
      var row = $('<tr></tr>');
      row.append($('<td></td>').addClass('fw-bold text-primary').text(r.RepairID));
      row.append($('<td></td>').text(r.ReceiveDate));
      row.append($('<td></td>').text(r.CustomerName));
      row.append($('<td></td>').text((r.Brand || '') + ' ' + (r.Model || '')));
      row.append($('<td></td>').html('<span class="status-badge ' + getStatusBadgeClass(r.Status) + '">' + r.Status + '</span>'));
      row.append($('<td></td>').text(r.Technician || '-'));
      row.append($('<td></td>').text(price.toLocaleString('th-TH', {minimumFractionDigits:2})));
      row.append($('<td></td>').text(cost.toLocaleString('th-TH', {minimumFractionDigits:2})));
      row.append($('<td></td>').addClass(profit >= 0 ? 'text-success fw-bold' : 'text-danger fw-bold').text(profit.toLocaleString('th-TH', {minimumFractionDigits:2})));
      tbody.append(row);
    });
  }

  $('#reportSummaryCards').show();
  $('#reportExportButtons').attr('style', 'display: flex !important;');
  $('#reportTableContainer').show();
}

function exportReportToExcel() {
  var rows = [];
  var headers = ['รหัสงาน', 'วันที่รับ', 'ลูกค้า', 'ยี่ห้อ/รุ่น', 'สถานะ', 'ช่างรับผิดชอบ', 'ค่าบริการ (บาท)', 'ต้นทุนอะไหล่ (บาท)', 'กำไร (บาท)'];
  rows.push(headers);
  
  $('#reportsTable tbody tr').each(function() {
    var row = [];
    $(this).find('td').each(function() {
      var text = $(this).text().replace(/,/g, '');
      row.push(text);
    });
    if (row.length > 1) {
      rows.push(row);
    }
  });

  var csvContent = '\uFEFF'; // UTF-8 BOM
  rows.forEach(function(rowArray) {
    var rowStr = rowArray.map(function(val) {
      return '"' + val.toString().replace(/"/g, '""') + '"';
    }).join(',');
    csvContent += rowStr + '\r\n';
  });

  var blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  var link = document.createElement('a');
  var url = URL.createObjectURL(blob);
  
  var filename = 'GPS_Repair_Report_' + (new Date().toISOString().slice(0, 10)) + '.csv';
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function exportReportToPDF() {
  window.print();
}

/* ==========================================================================
   Slip Printing Layout
   ========================================================================== */

function printRepairSlip() {
  var item = repairsCache.find(function(r) { return r.RepairID === currentActiveRepairId; });
  if (!item) return;
  
  var shop = settingsCache;
  var shopName = shop.ShopName || 'GPS Repair Service';
  var shopPhone = shop.ShopPhone || '';
  var shopAddress = shop.ShopAddress || '';
  var lineID = shop.LineID || '';

  var html = `
    <div style="font-family: 'Prompt', sans-serif; max-width: 400px; margin: 0 auto; color: black; line-height: 1.4;">
      <div style="text-align: center; border-bottom: 2px dashed #000; padding-bottom: 15px; margin-bottom: 15px;">
        <h3 style="margin: 0 0 5px 0;">${shopName}</h3>
        <p style="margin: 0; font-size: 12px;">${shopAddress}</p>
        <p style="margin: 5px 0 0 0; font-size: 12px;"><b>โทร:</b> ${shopPhone} | <b>Line:</b> ${lineID}</p>
      </div>
      
      <div style="text-align: center; margin-bottom: 15px;">
        <h4 style="margin: 0 0 5px 0; letter-spacing: 1px;">ใบรับฝากซ่อม GPS</h4>
        <h3 style="margin: 0; color: #000; font-weight: bold;">${item.RepairID}</h3>
      </div>
      
      <table style="width: 100%; font-size: 13px; border-collapse: collapse; margin-bottom: 15px;">
        <tr>
          <td style="padding: 3px 0; width: 45%;"><b>วันที่รับเรื่อง:</b></td>
          <td style="padding: 3px 0; text-align: right;">${item.ReceiveDate || '-'}</td>
        </tr>
        <tr>
          <td style="padding: 3px 0;"><b>ชื่อลูกค้า:</b></td>
          <td style="padding: 3px 0; text-align: right;">${item.CustomerName}</td>
        </tr>
        <tr>
          <td style="padding: 3px 0;"><b>เบอร์โทรศัพท์:</b></td>
          <td style="padding: 3px 0; text-align: right;">${item.Phone}</td>
        </tr>
        <tr style="border-top: 1px dashed #ccc; border-bottom: 1px dashed #ccc;">
          <td colspan="2" style="padding: 5px 0; font-weight: bold;">รายละเอียดเครื่อง:</td>
        </tr>
        <tr>
          <td style="padding: 3px 0;"><b>ยี่ห้อ / รุ่น:</b></td>
          <td style="padding: 3px 0; text-align: right;">${item.Brand || '-'} / ${item.Model || '-'}</td>
        </tr>
        <tr>
          <td style="padding: 3px 0;"><b>Serial Number:</b></td>
          <td style="padding: 3px 0; text-align: right;">${item.SerialNumber}</td>
        </tr>
        <tr>
          <td style="padding: 3px 0;"><b>อุปกรณ์ที่ส่งมาด้วย:</b></td>
          <td style="padding: 3px 0; text-align: right;">${item.Accessories || '-'}</td>
        </tr>
        <tr style="border-top: 1px dashed #ccc; border-bottom: 1px dashed #ccc;">
          <td colspan="2" style="padding: 5px 0; font-weight: bold; color: red;">อาการเสียที่แจ้ง:</td>
        </tr>
        <tr>
          <td colspan="2" style="padding: 5px 0; font-size: 13px;">${item.Problem}</td>
        </tr>
        <tr style="border-top: 1px dashed #ccc;">
          <td style="padding: 6px 0; font-weight: bold;">ประมาณการค่าใช้จ่าย:</td>
          <td style="padding: 6px 0; text-align: right; font-weight: bold; font-size: 15px;">฿${parseFloat(item.Price || 0).toLocaleString('th-TH', {minimumFractionDigits: 2})}</td>
        </tr>
        <tr>
          <td style="padding: 3px 0;"><b>กำหนดเสร็จคร่าวๆ:</b></td>
          <td style="padding: 3px 0; text-align: right;">${item.DueDate || '-'}</td>
        </tr>
      </table>

      <div style="border-top: 2px dashed #000; padding-top: 15px; font-size: 11px; text-align: center;">
        <p style="margin: 0 0 10px 0;">* กรุณาเก็บใบรับซ่อมนี้ไว้เป็นหลักฐานตอนรับเครื่องคืน *</p>
        <p style="margin: 0 0 10px 0;">คุณสามารถตรวจสอบสถานะการซ่อมได้แบบเรียลไทม์ที่หน้าเว็บ<br>โดยใช้หมายเลขใบรับซ่อม <b>${item.RepairID}</b></p>
        <h5 style="margin: 15px 0 0 0;">ขอขอบพระคุณที่ใช้บริการ</h5>
      </div>
    </div>
  `;

  $('#printSlipContainer').html(html);
  window.print();
}

/* ==========================================================================
   Settings Page (System / Techs CRUD)
   ========================================================================== */

function loadPublicSettings() {
  return callAPI('getSettings', {}, 'GET')
    .then(function(res) {
      settingsCache = res.data;
    })
    .catch(function(error) {
      console.error(error);
    });
}

function loadSettingsPageData() {
  callAPI('getSettings', {}, 'GET')
    .then(function(res) {
      settingsCache = res.data;
      $('#set-ShopName').val(settingsCache.ShopName || '');
      $('#set-ShopPhone').val(settingsCache.ShopPhone || '');
      $('#set-LineID').val(settingsCache.LineID || '');
      $('#set-ShopEmail').val(settingsCache.ShopEmail || '');
      $('#set-ShopAddress').val(settingsCache.ShopAddress || '');
    });

  loadTechniciansSettingsTable();
}

function saveSystemSettings(event) {
  event.preventDefault();
  var payload = {
    ShopName: $('#set-ShopName').val(),
    ShopPhone: $('#set-ShopPhone').val(),
    LineID: $('#set-LineID').val(),
    ShopEmail: $('#set-ShopEmail').val(),
    ShopAddress: $('#set-ShopAddress').val()
  };

  Swal.fire({
    title: 'กำลังบันทึกการตั้งค่า...',
    allowOutsideClick: false,
    didOpen: function() { Swal.showLoading(); }
  });

  callAPI('saveSettings', payload)
    .then(function() {
      settingsCache = payload;
      Swal.fire('บันทึกสำเร็จ!', 'ข้อมูลร้านค้าอัปเดตเรียบร้อย', 'success');
    })
    .catch(function(error) {
      Swal.fire('ข้อผิดพลาด', error.message, 'error');
    });
}

function loadTechniciansSettingsTable() {
  callAPI('getTechnicians', {}, 'GET')
    .then(function(res) {
      var techs = res.data;
      var tbody = $('#techSettingsTable tbody');
      tbody.empty();
      
      techs.forEach(function(t) {
        var row = $('<tr></tr>');
        row.append($('<td></td>').addClass('fw-bold').text(t.Username));
        row.append($('<td></td>').text(t.Name));
        row.append($('<td></td>').html('<span class="badge bg-secondary">' + t.Role + '</span>'));
        
        var activeBadge = t.Active === 'Yes' ? '<span class="badge bg-success">ปกติ</span>' : '<span class="badge bg-danger">ระงับ</span>';
        row.append($('<td></td>').html(activeBadge));
        
        var editBtn = $('<button class="btn btn-sm btn-outline-warning me-1"><i class="fa-solid fa-pen"></i></button>').click(function() {
          openEditTechnicianModal(t);
        });
        
        var deleteBtn = $('<button class="btn btn-sm btn-outline-danger"><i class="fa-solid fa-trash"></i></button>').click(function() {
          deleteTechnicianUser(t.Username);
        });

        if (t.Username.toLowerCase() === 'admin') {
          deleteBtn.attr('disabled', true);
        }

        row.append($('<td></td>').append(editBtn).append(deleteBtn));
        tbody.append(row);
      });
    });
}

function openNewTechnicianModal() {
  $('#tech-actionType').val('add');
  $('#tech-Username').attr('disabled', false).val('');
  $('#tech-Password').attr('required', true).val('');
  $('#tech-Name').val('');
  $('#tech-Role').val('Technician');
  $('#tech-Active').val('Yes');
  $('#techUserModalTitle').text('เพิ่มช่างเทคนิค/ผู้ใช้งานใหม่');
  new bootstrap.Modal(document.getElementById('techUserModal')).show();
}

function openEditTechnicianModal(tech) {
  $('#tech-actionType').val('edit');
  $('#tech-Username').attr('disabled', true).val(tech.Username);
  $('#tech-Password').attr('required', false).val('');
  $('#tech-Name').val(tech.Name);
  $('#tech-Role').val(tech.Role);
  $('#tech-Active').val(tech.Active);
  $('#techUserModalTitle').text('แก้ไขผู้ใช้งาน: ' + tech.Username);
  new bootstrap.Modal(document.getElementById('techUserModal')).show();
}

function submitTechUserForm(event) {
  event.preventDefault();
  var action = $('#tech-actionType').val();
  var username = $('#tech-Username').val();
  var payload = {
    Username: username,
    Password: $('#tech-Password').val(),
    Name: $('#tech-Name').val(),
    Role: $('#tech-Role').val(),
    Active: $('#tech-Active').val()
  };

  Swal.fire({
    title: 'กำลังบันทึกผู้ใช้...',
    allowOutsideClick: false,
    didOpen: function() { Swal.showLoading(); }
  });

  var successCallback = function() {
    bootstrap.Modal.getInstance(document.getElementById('techUserModal')).hide();
    Swal.fire('บันทึกสำเร็จ', 'บัญชีผู้ใช้ได้รับการบันทึกแล้ว', 'success');
    loadTechniciansSettingsTable();
  };

  var errorCallback = function(error) {
    Swal.fire('ล้มเหลว', error.message, 'error');
  };

  if (action === 'add') {
    if (payload.Password.length < 4) {
      Swal.fire('แจ้งเตือน', 'กรุณากำหนดรหัสผ่านอย่างน้อย 4 ตัวอักษร', 'warning');
      return;
    }
    callAPI('addTechnician', payload)
      .then(successCallback)
      .catch(errorCallback);
  } else {
    callAPI('updateTechnician', payload)
      .then(successCallback)
      .catch(errorCallback);
  }
}

function deleteTechnicianUser(username) {
  Swal.fire({
    title: 'ยืนยันการลบบัญชี?',
    text: 'ลบบัญชีผู้ใช้ ' + username + ' ออกจากระบบ',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#d33',
    confirmButtonText: 'ใช่, ฉันต้องการลบ'
  }).then(function(result) {
    if (result.isConfirmed) {
      callAPI('deleteTechnician', { username: username })
        .then(function() {
          Swal.fire('ลบเรียบร้อย', 'ลบผู้ใช้สำเร็จ', 'success');
          loadTechniciansSettingsTable();
        })
        .catch(function(error) {
          Swal.fire('ผิดพลาด', error.message, 'error');
        });
    }
  });
}

/* ==========================================================================
   Utilities
   ========================================================================== */

function getStatusBadgeClass(status) {
  switch (status) {
    case 'รับเครื่องแล้ว': return 'badge-pending';
    case 'รอตรวจสอบ': return 'badge-pending';
    case 'กำลังซ่อม': return 'badge-fixing';
    case 'รออะไหล่': return 'badge-fixing';
    case 'ซ่อมเสร็จ': return 'badge-finished';
    case 'ส่งคืนแล้ว': return 'badge-returned';
    default: return 'bg-secondary text-white';
  }
}

function getStatusStepNumber(status) {
  switch (status) {
    case 'รับเครื่องแล้ว': return 1;
    case 'รอตรวจสอบ': return 2;
    case 'กำลังซ่อม': return 3;
    case 'รออะไหล่': return 4;
    case 'ซ่อมเสร็จ': return 5;
    case 'ส่งคืนแล้ว': return 6;
    default: return 1;
  }
}

function getGoogleDriveFileId(url) {
  if (!url) return null;
  var match = url.match(/[-\w]{25,}/);
  return match ? match[0] : null;
}
