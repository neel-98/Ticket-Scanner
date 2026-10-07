import { createContext, useContext } from 'react';
import type { Profile } from '../types';
export const AppContext = createContext<{ profile: Profile; demo: boolean }>({ profile: { user_id: '', role: 'checkin', active: false }, demo: false });
export const useApp = () => useContext(AppContext);
