/**
 * Browser Entry Point for Ruankao Exam Web
 */
(function () {
  'use strict';

  class RootErrorBoundary extends React.Component {
    constructor(props) {
      super(props);
      this.state = { hasError: false, error: null };
      this.handleReset = this.handleReset.bind(this);
    }

    static getDerivedStateFromError(error) {
      return { hasError: true, error };
    }

    componentDidCatch(error, errorInfo) {
      console.error('[RootErrorBoundary] Caught uncaught UI error:', error, errorInfo);
    }

    handleReset() {
      try {
        localStorage.removeItem('ruankao_active_session_id');
      } catch (e) {}
      window.location.href = '/';
    }

    render() {
      if (this.state.hasError) {
        return React.createElement('div', {
          className: 'error-boundary-fallback',
          style: {
            padding: '40px 20px',
            maxWidth: '640px',
            margin: '60px auto',
            textAlign: 'center',
            backgroundColor: '#ffffff',
            borderRadius: '12px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
          }
        },
          React.createElement('h2', { style: { color: '#e53e3e', marginBottom: '12px', fontSize: '20px' } }, '页面渲染遇到临时异常'),
          React.createElement('p', { style: { color: '#4a5568', fontSize: '14px', lineHeight: '1.6', marginBottom: '20px' } },
            '答题平台检测到未预料的页面渲染错误。系统已自动保护您的所有本地答题进度与题库数据。'
          ),
          React.createElement('div', {
            style: {
              padding: '12px',
              backgroundColor: '#fff5f5',
              border: '1px solid #feb2b2',
              borderRadius: '6px',
              color: '#c53030',
              fontSize: '13px',
              fontFamily: 'monospace',
              textAlign: 'left',
              marginBottom: '24px',
              wordBreak: 'break-all',
              maxHeight: '120px',
              overflowY: 'auto'
            }
          }, (this.state.error && this.state.error.message) || String(this.state.error)),
          React.createElement('div', { style: { display: 'flex', gap: '12px', justifyContent: 'center' } },
            React.createElement('button', {
              type: 'button',
              onClick: () => this.setState({ hasError: false, error: null }),
              style: {
                padding: '10px 20px',
                backgroundColor: '#3182ce',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: '500'
              }
            }, '重试加载'),
            React.createElement('button', {
              type: 'button',
              onClick: this.handleReset,
              style: {
                padding: '10px 20px',
                backgroundColor: '#edf2f7',
                color: '#2d3748',
                border: '1px solid #cbd5e0',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: '500'
              }
            }, '清除会话缓存并返回真题首页')
          )
        );
      }
      return this.props.children;
    }
  }

  function initApp() {
    const rootEl = document.getElementById('root');
    if (!rootEl) return;

    const apiClient = new window.ExamApiClient();
    const appElement = React.createElement(
      RootErrorBoundary,
      null,
      React.createElement(window.App, { apiClient })
    );

    if (ReactDOM.createRoot) {
      const root = ReactDOM.createRoot(rootEl);
      root.render(appElement);
    } else {
      ReactDOM.render(appElement, rootEl);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }
})();
