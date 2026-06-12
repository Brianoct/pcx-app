import { Component } from 'react';
import { useLocation } from 'react-router-dom';

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Single hook point for future error reporting (e.g. Sentry).
    console.error('Panel crash:', error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="error-boundary">
        <h2>Algo salió mal en esta sección</h2>
        <p>
          El resto de la aplicación sigue funcionando. Puedes volver a intentar
          o navegar a otra sección desde el menú.
        </p>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => this.setState({ error: null })}
        >
          Reintentar
        </button>
      </div>
    );
  }
}

// Remounts the boundary on navigation so an error in one section
// doesn't stick when the user moves to another.
export function RouteErrorBoundary({ children }) {
  const location = useLocation();
  return <ErrorBoundary key={location.pathname}>{children}</ErrorBoundary>;
}

export default ErrorBoundary;
