import { testMocksEnabled } from '../build-flags';
import productTemplate from './template.html?raw';
import developmentRail from './development-rail.html?raw';

// The development controls are a separate raw asset so their markup and fixture
// actions are eliminated from flag-off bundles, not merely hidden by sc-if.
export default productTemplate.replace('<!-- alpha-development-rail -->', testMocksEnabled ? developmentRail : '');
