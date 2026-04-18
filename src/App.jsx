import { useState } from 'react'
import reactLogo from './assets/react.svg'
import viteLogo from '/vite.svg'
import './App.css'
import { BrowserRouter,Routes,Route } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import Home from './pages/Home';
import EditorPage from './pages/EditorPage';

function App() {
  const [count, setCount] = useState(0)

  return (
    <>
    <BrowserRouter>
    <Toaster
    position="top-right"
    toastOptions={{
      success:{
        theme:{
          primary:"#4aed88",
        },
      },
    }}
    ></Toaster>
    <Routes>
      <Route path="/" element={<Home/>}></Route>
      <Route 
      path="/editor/:roomId" 
      element={<EditorPage/>}
      ></Route>


    </Routes>


    </BrowserRouter>

    </>
  )
}

export default App
