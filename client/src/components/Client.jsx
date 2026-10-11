import React from 'react';
import Avatar from 'react-avatar';

const Client = ({ client, canManage, onPermissionChange, onTransferOwnership, onRemoveClient }) => {
  const isOwner = client.permission === 'owner';
  return (
    <div className="client">
      <Avatar name={client.username} size={46} round="14px" />
      <span className="userName">{client.username}</span>
      {isOwner ? (
        <span className="clientRole ownerRole">Owner</span>
      ) : canManage ? (
        <>
          <label className="permissionControl">
            <span className="visuallyHidden">Permission for {client.username}</span>
            <select
              aria-label={`Permission for ${client.username}`}
              value={client.permission || 'editor'}
              onChange={(event) => onPermissionChange(client.socketId, event.target.value)}
            >
              <option value="editor">Editor</option>
              <option value="viewer">Viewer</option>
            </select>
          </label>
          <div className="clientManagementActions">
            <button type="button" onClick={() => onTransferOwnership(client)} title={`Make ${client.username} the room owner`}>
              Make owner
            </button>
            <button type="button" onClick={() => onRemoveClient(client)} title={`Remove ${client.username} from the room`}>
              Remove
            </button>
          </div>
        </>
      ) : (
        <span className="clientRole">{client.permission === 'viewer' ? 'Viewer' : 'Editor'}</span>
      )}
    </div>
  );
};

export default Client;
