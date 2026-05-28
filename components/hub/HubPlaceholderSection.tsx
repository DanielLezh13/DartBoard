"use client"

import type React from "react"
import { useState } from "react"
import { BrandHeading } from "@/components/ui/BrandHeading"

const courses = [
  {
    title: "Advanced React Patterns",
    provider: "Frontend Masters",
    progress: 65,
    duration: "8 hours",
    level: "Advanced",
    image: "/react-logo-abstract.png",
  },
  {
    title: "System Design Interview Prep",
    provider: "Educative",
    progress: 30,
    duration: "12 hours",
    level: "Intermediate",
    image: "/system-design.jpg",
  },
  {
    title: "TypeScript Deep Dive",
    provider: "Udemy",
    progress: 100,
    duration: "6 hours",
    level: "Intermediate",
    image: "/typescript-logo.png",
  },
  {
    title: "Leadership for Engineers",
    provider: "LinkedIn Learning",
    progress: 15,
    duration: "4 hours",
    level: "Beginner",
    image: "/diverse-group-leadership.png",
  },
]

const recommendations = [
  { title: "Docker & Kubernetes", reason: "Based on your DevOps interest", priority: "High" },
  { title: "GraphQL Fundamentals", reason: "Complements your React skills", priority: "Medium" },
  { title: "AWS Solutions Architect", reason: "Popular in your target roles", priority: "High" },
]

export default function HubPlaceholderSection() {
  const [certificateFile, setCertificateFile] = useState<File | null>(null)

  const handleCertificateUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setCertificateFile(file)
    }
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <BrandHeading className="mb-2">Learning Resources</BrandHeading>
          <p className="text-gray-400">Continue your professional development journey</p>
        </div>
        <label htmlFor="certificate-upload">
          <button className="cursor-pointer border border-gray-600 hover:border-gray-500 bg-transparent text-gray-300 px-4 py-2 rounded-lg hover:bg-gray-800 transition-colors">
            <svg className="w-4 h-4 inline mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            Upload Certificate
          </button>
          <input
            id="certificate-upload"
            type="file"
            accept=".pdf,.jpg,.jpeg,.png"
            className="hidden"
            onChange={handleCertificateUpload}
          />
        </label>
      </div>

      {certificateFile && (
        <div className="border border-blue-500/30 bg-gray-800/50 p-4 rounded-lg">
          <p className="text-sm text-blue-400">✓ Certificate uploaded: {certificateFile.name}</p>
        </div>
      )}

      <div className="grid md:grid-cols-3 gap-4">
        <div className="bg-gray-800/70 hover:bg-gray-800 transition-all p-6 rounded-xl border border-gray-700 hover:border-gray-600">
          <h3 className="text-sm font-medium text-gray-400 mb-2">Courses In Progress</h3>
          <div className="text-3xl font-bold">4</div>
          <p className="text-xs text-gray-400 mt-1">2 completed this month</p>
        </div>
        <div className="bg-gray-800/70 hover:bg-gray-800 transition-all p-6 rounded-xl border border-gray-700 hover:border-gray-600">
          <h3 className="text-sm font-medium text-gray-400 mb-2">Learning Hours</h3>
          <div className="text-3xl font-bold">47h</div>
          <p className="text-xs text-gray-400 mt-1">This quarter</p>
        </div>
        <div className="bg-gray-800/70 hover:bg-gray-800 transition-all p-6 rounded-xl border border-gray-700 hover:border-gray-600">
          <h3 className="text-sm font-medium text-gray-400 mb-2">Certificates Earned</h3>
          <div className="text-3xl font-bold">12</div>
          <p className="text-xs text-gray-400 mt-1">+3 this year</p>
        </div>
      </div>

      <div className="bg-gray-800/70 border border-blue-500/50 p-6 rounded-xl">
        <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
          </svg>
          AI-Recommended Courses
        </h2>
        <p className="text-gray-400 mb-4">Personalized learning paths based on your career goals</p>
        <div className="space-y-3">
          {recommendations.map((rec, index) => (
            <div
              key={index}
              className="flex items-center justify-between p-3 rounded-lg bg-gray-800/50 border border-gray-700"
            >
              <div>
                <h4 className="font-medium">{rec.title}</h4>
                <p className="text-sm text-gray-400">{rec.reason}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`px-2 py-1 text-xs rounded ${rec.priority === "High" ? "bg-blue-500 text-white" : "bg-gray-600 text-gray-300"}`}>
                  {rec.priority}
                </span>
                <button className="text-gray-400 hover:text-white text-sm">
                  View
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h2 className="text-2xl font-bold mb-4">My Courses</h2>
        <div className="grid md:grid-cols-2 gap-6">
          {courses.map((course, index) => (
            <div key={index} className="bg-gray-800/70 hover:bg-gray-800 transition-all rounded-xl border border-gray-700 hover:border-gray-600 overflow-hidden">
              <div className="aspect-video bg-gray-700 relative">
                <img
                  src={course.image || "/placeholder.svg"}
                  alt={course.title}
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                <span className="absolute top-3 right-3 px-2 py-1 text-xs rounded bg-gray-800 text-gray-300">
                  {course.level}
                </span>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <h3 className="text-lg font-semibold mb-2">{course.title}</h3>
                  <div className="flex items-center gap-4 text-xs text-gray-400">
                    <span>{course.provider}</span>
                    <span className="flex items-center gap-1">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      {course.duration}
                    </span>
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-gray-400">Progress</span>
                    <span className="text-sm font-medium">{course.progress}%</span>
                  </div>
                  <div className="w-full bg-gray-700 rounded-full h-2">
                    <div 
                      className="bg-blue-500 h-2 rounded-full" 
                      style={{ width: `${course.progress}%` }}
                    ></div>
                  </div>
                </div>
                <button className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg transition-colors">
                  {course.progress === 100 ? (
                    <>
                      <svg className="w-4 h-4 inline mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      View Certificate
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4 inline mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Continue Learning
                    </>
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-gray-800/70 hover:bg-gray-800 transition-all p-6 rounded-xl border border-gray-700 hover:border-gray-600">
        <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>
          Explore More Courses
        </h2>
        <button className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:opacity-90 text-white py-3 rounded-lg transition-opacity">
          Browse Course Catalog
        </button>
      </div>
    </div>
  )
}
