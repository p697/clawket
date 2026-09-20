import { configure } from '@testing-library/react-native';

// Screens rendered through the react-native mock can take several seconds to commit a large list
// on a starved CI runner; RNTL's 1 s default made `waitFor` a load test instead of a state check.
configure({ asyncUtilTimeout: 5000 });
