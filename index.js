// index.js
import { registerRootComponent } from 'expo';
import App from './App';
import AdminApp from './AdminApp';

// Change this to 'true' to load the Admin App, or 'false' for the User App.
const IS_ADMIN = false; 

if (IS_ADMIN) {
  registerRootComponent(AdminApp);
} else {
  registerRootComponent(App);
}
