// Part of the Syllentras chat widget.
// Included inside the shared IIFE from before_footer.php — do not load standalone.

var PAGE_SIZE = 30;
var PANEL_MARGIN = 16;
var PANEL_MIN_WIDTH = 360;
var INPUT_MIN_HEIGHT = 42;
var INPUT_MAX_HEIGHT = 180;
var MESSAGES_MIN_HEIGHT = 120;
var PANEL_CHROME_HEIGHT = 130;
var PANEL_MIN_HEIGHT = PANEL_CHROME_HEIGHT + MESSAGES_MIN_HEIGHT + INPUT_MAX_HEIGHT;
var PANEL_DEFAULT_WIDTH = 620;
var PANEL_DEFAULT_HEIGHT = 520;
var PANEL_DEFAULT_RIGHT = 24;
var PANEL_DEFAULT_BOTTOM = 88;

var btn       = document.getElementById('syllentras-chat-btn');
var panel     = document.getElementById('syllentras-chat-panel');
var close     = document.getElementById('syllentras-chat-close');
var expandBtn = document.getElementById('syllentras-chat-expand');
var resetBtn  = document.getElementById('syllentras-chat-reset');
var input     = document.getElementById('syllentras-chat-input');
var send      = document.getElementById('syllentras-chat-send');
var toolsBtn  = document.getElementById('syllentras-chat-tools-btn');
var msgs      = document.getElementById('syllentras-chat-messages');
var loadMore  = document.getElementById('syllentras-chat-load-more');
var courseEl  = document.getElementById('syllentras-chat-course');
var header    = document.getElementById('syllentras-chat-header');
var sidebar   = document.getElementById('syllentras-chat-sidebar');
var sidebarResizer = document.getElementById('syllentras-chat-sidebar-resizer');
var inputResizer = document.getElementById('syllentras-chat-input-resizer');
var modal     = document.getElementById('syllentras-chat-modal');
var conversationsEl = document.getElementById('syllentras-chat-conversations');
var searchInput = document.getElementById('syllentras-chat-search');
var newBtn = document.getElementById('syllentras-chat-new');
var activeTitle = document.getElementById('syllentras-chat-active-title');
var activeTag = document.getElementById('syllentras-chat-active-tag');
var pendingDeleteConversation = null;
var openMenu = null;

courseEl.textContent = (courseId > 1 && courseName) ? courseName : 'Dashboard';

var conversationId = null;
var activeConversation = null;
var hasMore = false;
var loadingHistory = false;
var loadingOlder = false;
var layoutSaveTimer = null;
var isDraggingPanel = false;
var isResizingPanel = false;
var isResizingSidebar = false;
var isResizingInput = false;
var dragOffsetX = 0;
var dragOffsetY = 0;
var resizeEdge = null;
var resizeStartX = 0;
var resizeStartY = 0;
var resizeStartRect = null;
var inputResizeStartY = 0;
var inputResizeStartHeight = 0;
var mobileLayout = window.matchMedia('(max-width: 700px)');
var isExpanded = localStorage.getItem('syllentras_expanded') === '1';
var SIDEBAR_MIN_WIDTH = 150;
var SIDEBAR_MAX_WIDTH = 340;
var SIDEBAR_DEFAULT_WIDTH = 190;
