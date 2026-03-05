import { NavLink } from 'react-router-dom';
import { Compass, Luggage, User } from 'lucide-react';

export default function NavBar() {
    return (
        <nav className="nav-bar" id="main-nav">
            <NavLink to="/" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} end>
                <Compass />
                <span>Explorar</span>
            </NavLink>
            <NavLink to="/mis-viajes" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                <Luggage />
                <span>Mis Viajes</span>
            </NavLink>
            <NavLink to="/profile" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                <User />
                <span>Perfil</span>
            </NavLink>
        </nav>
    );
}
