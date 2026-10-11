import React, { useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import { getSavedRooms, removeSavedRoom, saveRoom } from '../roomStorage';

const Home = () => {
  const navigate = useNavigate();
  const [roomId, setRoomId] = useState('');
  const [username, setUsername] = useState('');
  const [savedRooms, setSavedRooms] = useState(() => getSavedRooms());

  const createNewRoom = (e) => {
    e.preventDefault();
    const id = uuidv4();
    setRoomId(id);
    toast.success('Created a new room');
  };

  const joinRoom = (targetRoomId = roomId, targetUsername = username) => {
    if (!targetRoomId.trim() || !targetUsername.trim()) {
      toast.error('ROOM ID & username is required');
      return;
    }

    saveRoom(targetRoomId, targetUsername);
    setSavedRooms(getSavedRooms());
    navigate(`/editor/${targetRoomId.trim()}`, {
      state: {
        username: targetUsername.trim(),
      },
    });
  };

  const forgetRoom = (targetRoomId) => {
    removeSavedRoom(targetRoomId);
    setSavedRooms(getSavedRooms());
  };

  const handleInputEnter = (e) => {
    if (e.code === 'Enter') {
      joinRoom();
    }
  };

  return (
    <div className="mainWrap">
      <div className="formWrap">
        <h2 className="mainLabel">Collaborative Code Editor</h2>
        <div className="inputGroup">
          <input
            type="text"
            className="inputBox"
            placeholder="ROOM ID"
            onChange={(e) => setRoomId(e.target.value)}
            value={roomId}
            onKeyUp={handleInputEnter}
          />
          <input
            type="text"
            className="inputBox"
            placeholder="USERNAME"
            onChange={(e) => setUsername(e.target.value)}
            value={username}
            onKeyUp={handleInputEnter}
          />
          <button className="btn joinBtn" onClick={() => joinRoom()}>
            Join
          </button>
          <span className="createInfo">
            If you don't have an invite then create &nbsp;
            <a onClick={createNewRoom} href="" className="createNewBtn">
              new room
            </a>
          </span>
        </div>
        {savedRooms.length > 0 && (
          <section className="savedRooms" aria-label="Recently opened rooms">
            <h3>Recent rooms</h3>
            {savedRooms.map((room) => (
              <div className="savedRoom" key={room.roomId}>
                <button
                  type="button"
                  className="savedRoomOpen"
                  onClick={() => joinRoom(room.roomId, username.trim() || room.username)}
                  title={`Open room ${room.roomId}`}
                >
                  <span>{room.roomId}</span>
                  <small>{room.username || 'Saved in this browser'}</small>
                </button>
                <button
                  type="button"
                  className="savedRoomRemove"
                  onClick={() => forgetRoom(room.roomId)}
                  aria-label={`Remove room ${room.roomId} from recent rooms`}
                  title="Remove from recent rooms"
                >
                  ×
                </button>
              </div>
            ))}
          </section>
        )}
      </div>
    </div>
  );
};

export default Home;
