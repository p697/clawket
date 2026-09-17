const { applyIosSigning } = require('./with-ios-signing.js');

describe('iOS signing propagation', () => {
  it('sets the configured team across the app and extension build configurations', () => {
    const project = { addBuildProperty: jest.fn() };
    expect(applyIosSigning(project, 'C8TM82D73W')).toBe(project);
    expect(project.addBuildProperty).toHaveBeenCalledWith('DEVELOPMENT_TEAM', 'C8TM82D73W');
  });
  it('leaves an unconfigured team alone and rejects malformed values', () => {
    const project = { addBuildProperty: jest.fn() };
    expect(applyIosSigning(project, undefined)).toBe(project);
    expect(project.addBuildProperty).not.toHaveBeenCalled();
    expect(() => applyIosSigning(project, 'invalid')).toThrow('Invalid');
  });
});
